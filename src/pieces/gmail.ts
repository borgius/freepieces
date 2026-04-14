/**
 * Gmail piece — direct Gmail REST API integration.
 *
 * Uses fetch() directly against Gmail API v1, eliminating the need for
 * the heavyweight googleapis package (~103MB) that @activepieces/piece-gmail
 * depends on. Zero external dependencies beyond the freepieces framework.
 *
 * Auth
 * ────
 *   OAuth2 via Google.  Credentials come from Cloudflare Secrets:
 *     GMAIL_CLIENT_ID     – set with:  wrangler secret put GMAIL_CLIENT_ID
 *     GMAIL_CLIENT_SECRET – set with:  wrangler secret put GMAIL_CLIENT_SECRET
 *
 *   Token storage & refresh follow the standard freepieces KV flow.
 */

import { createPiece } from '../framework/piece';
import type { PieceActionContext, PieceTriggerContext } from '../framework/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GMAIL_AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ─── Gmail REST helpers ───────────────────────────────────────────────────────

async function gmailFetch(
  accessToken: string,
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${GMAIL_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function getUserEmail(accessToken: string): Promise<string> {
  const profile = await gmailFetch(accessToken, '/users/me/profile') as { emailAddress: string };
  return profile.emailAddress;
}

// ─── MIME helpers ─────────────────────────────────────────────────────────────

/** Base64url-encode arbitrary bytes without any native Buffer dependency. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** UTF-8 aware base64 encode (for =?UTF-8?B?...?= subject headers). */
function b64utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

interface MailAttachment {
  filename: string;
  contentType: string;
  data: string; // base64-encoded content
}

/** Build a minimal RFC 2822 message and return it as a base64url string. */
function buildRawEmail(opts: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject: string;
  body: string;
  bodyType?: 'plain_text' | 'html';
  inReplyTo?: string;
  references?: string;
  attachments?: MailAttachment[];
}): string {
  const subjectEncoded = `=?UTF-8?B?${b64utf8(opts.subject)}?=`;
  const contentType = opts.bodyType === 'html' ? 'text/html' : 'text/plain';

  const headerLines = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(', ')}`,
    ...(opts.cc?.length ? [`Cc: ${opts.cc.join(', ')}`] : []),
    ...(opts.bcc?.length ? [`Bcc: ${opts.bcc.join(', ')}`] : []),
    ...(opts.replyTo?.length ? [`Reply-To: ${opts.replyTo.join(', ')}`] : []),
    `Subject: ${subjectEncoded}`,
    'MIME-Version: 1.0',
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
  ];

  let rawEmail: string;

  if (!opts.attachments?.length) {
    rawEmail = [
      ...headerLines,
      `Content-Type: ${contentType}; charset=UTF-8`,
      '',
      opts.body,
    ].join('\r\n');
  } else {
    const boundary = `boundary_${Math.random().toString(36).slice(2)}`;
    const bodySection = [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      '',
      opts.body,
    ].join('\r\n');

    const attachSections = opts.attachments.map(att =>
      [
        `--${boundary}`,
        `Content-Type: ${att.contentType}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        att.data,
      ].join('\r\n')
    );

    rawEmail = [
      ...headerLines,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      bodySection,
      ...attachSections,
      `--${boundary}--`,
    ].join('\r\n');
  }

  return base64url(new TextEncoder().encode(rawEmail));
}

// ─── Message parsing ──────────────────────────────────────────────────────────

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: GmailHeader[] };

function extractBodyParts(part: GmailPart): { text?: string; html?: string } {
  const decode = (data: string) => {
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  };
  if (part.mimeType === 'text/plain' && part.body?.data) return { text: decode(part.body.data) };
  if (part.mimeType === 'text/html' && part.body?.data) return { html: decode(part.body.data) };
  if (part.parts) {
    let text: string | undefined, html: string | undefined;
    for (const p of part.parts) { const s = extractBodyParts(p); text = text ?? s.text; html = html ?? s.html; }
    return { text, html };
  }
  return {};
}

function parseFullMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const payload = msg.payload as GmailPart | undefined;
  if (!payload) return msg;
  const headers: GmailHeader[] = (payload as unknown as { headers?: GmailHeader[] }).headers ?? [];
  const hm = Object.fromEntries(headers.map(h => [h.name.toLowerCase(), h.value]));
  const { text, html } = extractBodyParts(payload);
  return {
    id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds,
    from: hm['from'], to: hm['to'], cc: hm['cc'],
    subject: hm['subject'], date: hm['date'], messageId: hm['message-id'],
    body_text: text, body_html: html, snippet: msg.snippet,
  };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

type Auth = Record<string, string> | undefined;

function getToken(auth: Auth): string {
  const t = auth?.accessToken;
  if (!t) throw new Error('No access token available');
  return t;
}

async function sendEmail(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const senderEmail = (p.from as string | undefined) || (await getUserEmail(tok));
  const from = p.sender_name ? `${p.sender_name} <${senderEmail}>` : senderEmail;
  const to = ((p.receiver as string[]) ?? []).filter(Boolean);
  const cc = ((p.cc as string[]) ?? []).filter(Boolean);
  const bcc = ((p.bcc as string[]) ?? []).filter(Boolean);
  const replyTo = ((p.reply_to as string[]) ?? []).filter(Boolean);

  let threadId: string | undefined;
  if (p.in_reply_to) {
    const r = await gmailFetch(
      tok,
      `/users/me/messages?q=Rfc822msgid:${encodeURIComponent(p.in_reply_to as string)}`
    ) as { messages?: Array<{ threadId: string }> };
    threadId = r.messages?.[0]?.threadId;
  }

  const raw = buildRawEmail({
    from, to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    replyTo: replyTo.length ? replyTo : undefined,
    subject: p.subject as string,
    body: p.body as string,
    bodyType: p.body_type as 'plain_text' | 'html',
    inReplyTo: p.in_reply_to as string | undefined,
    references: p.in_reply_to as string | undefined,
  });

  if (p.draft) {
    return gmailFetch(tok, '/users/me/drafts', {
      method: 'POST',
      body: JSON.stringify({ message: { threadId, raw } }),
    });
  }
  return gmailFetch(tok, '/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ threadId, raw }),
  });
}

async function requestApprovalInMail(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const senderEmail = (p.from as string | undefined) || (await getUserEmail(tok));
  const from = p.sender_name ? `${p.sender_name} <${senderEmail}>` : senderEmail;
  const to = [(p.receiver as string)].filter(Boolean);
  const cc = ((p.cc as string[]) ?? []).filter(Boolean);
  const bcc = ((p.bcc as string[]) ?? []).filter(Boolean);
  const replyTo = ((p.reply_to as string[]) ?? []).filter(Boolean);

  const approveUrl = (p.approve_url as string) ?? '';
  const disapproveUrl = (p.disapprove_url as string) ?? '';
  const htmlBody = `<div>
  <p>${p.body as string}</p><br />
  <p>
    <a href="${approveUrl}" style="display:inline-block;padding:10px 20px;margin-right:10px;background:#2acc50;color:white;text-decoration:none;border-radius:4px;">Approve</a>
    <a href="${disapproveUrl}" style="display:inline-block;padding:10px 20px;background:#e4172b;color:white;text-decoration:none;border-radius:4px;">Disapprove</a>
  </p>
</div>`.trim();

  let threadId: string | undefined;
  if (p.in_reply_to) {
    const r = await gmailFetch(
      tok,
      `/users/me/messages?q=Rfc822msgid:${encodeURIComponent(p.in_reply_to as string)}`
    ) as { messages?: Array<{ threadId: string }> };
    threadId = r.messages?.[0]?.threadId;
  }

  const raw = buildRawEmail({
    from, to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    replyTo: replyTo.length ? replyTo : undefined,
    subject: p.subject as string,
    body: htmlBody,
    bodyType: 'html',
    inReplyTo: p.in_reply_to as string | undefined,
    references: p.in_reply_to as string | undefined,
  });

  return gmailFetch(tok, '/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ threadId, raw }),
  });
}

async function replyToEmail(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const orig = await gmailFetch(
    tok, `/users/me/messages/${p.message_id}?format=full`
  ) as Record<string, unknown>;
  const payload = orig.payload as { headers?: GmailHeader[] };
  const hm = Object.fromEntries((payload?.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));

  const currentUserEmail = await getUserEmail(tok);
  const toList: string[] = [];
  const ccList: string[] = [];

  if (p.reply_type === 'reply_all') {
    const replyTarget = hm['reply-to'] || hm['from'];
    if (replyTarget) toList.push(replyTarget);
    if (hm['to']) hm['to'].split(',').map((e: string) => e.trim()).filter((e: string) => !e.includes(currentUserEmail)).forEach((e: string) => toList.push(e));
    if (hm['cc']) hm['cc'].split(',').map((e: string) => e.trim()).filter((e: string) => !e.includes(currentUserEmail)).forEach((e: string) => ccList.push(e));
  } else {
    const target = hm['reply-to'] || hm['from'];
    if (target) toList.push(target);
  }

  const origSubject = hm['subject'] ?? '';
  const replySubject = origSubject.toLowerCase().startsWith('re:') ? origSubject : `Re: ${origSubject}`;
  const origMessageId = hm['message-id'] ?? '';
  const references = hm['references'] ? `${hm['references']} ${origMessageId}` : origMessageId;
  const from = p.sender_name ? `${p.sender_name} <${currentUserEmail}>` : currentUserEmail;

  const raw = buildRawEmail({
    from, to: toList,
    cc: ccList.length ? ccList : undefined,
    subject: replySubject,
    body: p.body as string,
    bodyType: p.body_type as 'plain_text' | 'html',
    inReplyTo: origMessageId,
    references,
  });

  return gmailFetch(tok, '/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ threadId: orig.threadId as string, raw }),
  });
}

async function createDraftReply(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const orig = await gmailFetch(
    tok, `/users/me/messages/${p.message_id}?format=full`
  ) as Record<string, unknown>;
  const payload = orig.payload as { headers?: GmailHeader[] };
  const hm = Object.fromEntries((payload?.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));

  const currentUserEmail = await getUserEmail(tok);
  const toList: string[] = [];
  const ccList: string[] = [];

  if (p.reply_type === 'reply_all') {
    const replyTarget = hm['reply-to'] || hm['from'];
    if (replyTarget) toList.push(replyTarget);
    if (hm['to']) hm['to'].split(',').map((e: string) => e.trim()).filter((e: string) => !e.includes(currentUserEmail)).forEach((e: string) => toList.push(e));
    if (hm['cc']) hm['cc'].split(',').map((e: string) => e.trim()).filter((e: string) => !e.includes(currentUserEmail)).forEach((e: string) => ccList.push(e));
  } else {
    const replyTarget = hm['reply-to'] || hm['from'];
    if (replyTarget) toList.push(replyTarget);
  }

  const origSubject = hm['subject'] ?? '';
  const replySubject = origSubject.toLowerCase().startsWith('re:') ? origSubject : `Re: ${origSubject}`;
  const origMessageId = hm['message-id'] ?? '';
  const references = hm['references'] ? `${hm['references']} ${origMessageId}` : origMessageId;
  const from = p.sender_name ? `${p.sender_name} <${currentUserEmail}>` : currentUserEmail;

  let body = (p.body as string) ?? '';
  if (p.include_original_message) {
    const sep = p.body_type === 'html' ? '<br><br>--- Original Message ---<br>' : '\n\n--- Original Message ---\n';
    const quoted = p.body_type === 'html'
      ? `On ${hm['date'] ?? ''}, ${hm['from'] ?? ''} wrote:<br>[Original message]`
      : `On ${hm['date'] ?? ''}, ${hm['from'] ?? ''} wrote:\n> [Original message]`;
    body = body ? `${body}${sep}${quoted}` : quoted;
  }

  const raw = buildRawEmail({
    from, to: toList,
    cc: ccList.length ? ccList : undefined,
    subject: replySubject,
    body,
    bodyType: p.body_type as 'plain_text' | 'html',
    inReplyTo: origMessageId,
    references,
  });

  const draft = await gmailFetch(tok, '/users/me/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { threadId: orig.threadId as string, raw } }),
  }) as Record<string, unknown>;

  return {
    ...draft,
    originalMessage: { id: p.message_id, subject: origSubject, from: hm['from'], to: hm['to'], date: hm['date'], threadId: orig.threadId },
    draftDetails: { replyType: p.reply_type ?? 'reply', recipients: { to: toList, cc: ccList }, subject: replySubject, includeOriginal: Boolean(p.include_original_message) },
  };
}

async function getMail(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const msg = await gmailFetch(tok, `/users/me/messages/${p.message_id}?format=full`) as Record<string, unknown>;
  return parseFullMessage(msg);
}

async function searchMail(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;

  const qParts: string[] = [];
  if ((p.from as string)?.trim()) qParts.push(`from:(${(p.from as string).trim()})`);
  if ((p.to as string)?.trim()) qParts.push(`to:(${(p.to as string).trim()})`);
  if ((p.subject as string)?.trim()) qParts.push(`subject:(${(p.subject as string).trim()})`);
  if ((p.content as string)?.trim()) qParts.push(`"${(p.content as string).trim()}"`);
  if (p.has_attachment) qParts.push('has:attachment');
  if ((p.attachment_name as string)?.trim()) qParts.push(`filename:(${(p.attachment_name as string).trim()})`);
  if ((p.label as { name: string } | undefined)?.name) qParts.push(`label:${(p.label as { name: string }).name}`);
  if ((p.category as string)?.trim()) qParts.push(`category:${(p.category as string).trim()}`);
  if (p.after_date) { const d = new Date(p.after_date as string).toISOString().split('T')[0].replace(/-/g, '/'); qParts.push(`after:${d}`); }
  if (p.before_date) { const d = new Date(p.before_date as string).toISOString().split('T')[0].replace(/-/g, '/'); qParts.push(`before:${d}`); }

  const q = qParts.join(' ');
  if (!q.trim()) throw new Error('Please provide at least one search criterion');

  const max = Math.min(Math.max((p.max_results as number) || 10, 1), 500);
  const qs = new URLSearchParams({ q, maxResults: String(max) });
  if (p.include_spam_trash) qs.set('includeSpamTrash', 'true');

  const res = await gmailFetch(tok, `/users/me/messages?${qs}`) as { messages?: Array<{ id: string }> };
  const messages = res.messages ?? [];

  if (!messages.length) return { found: false, results: { messages: [], count: 0 } };

  const detailed = await Promise.all(
    messages.map(async ({ id }) => {
      try {
        return parseFullMessage(await gmailFetch(tok, `/users/me/messages/${id}?format=full`) as Record<string, unknown>);
      } catch {
        return { id, error: 'Failed to retrieve message details' };
      }
    })
  );

  return { found: true, results: { messages: detailed, count: detailed.length } };
}

async function customApiCall(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const method = (p.method as string) ?? 'GET';
  const path = p.url_path as string;
  const reqBody = p.body as Record<string, unknown> | undefined;
  return gmailFetch(tok, path, {
    method,
    ...(reqBody ? { body: JSON.stringify(reqBody) } : {}),
  });
}

async function getThread(ctx: PieceActionContext): Promise<unknown> {
  const tok = getToken(ctx.auth);
  const p = ctx.props as Record<string, unknown>;
  const format = (p.format as string) ?? 'full';
  return gmailFetch(tok, `/users/me/threads/${p.thread_id}?format=${format}`);
}

// ─── Label helpers ────────────────────────────────────────────────────────────

async function fetchLabels(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await gmailFetch(accessToken, '/users/me/labels') as { labels: Array<{ id: string; name: string }> };
  return res.labels ?? [];
}

// ─── Trigger helpers ──────────────────────────────────────────────────────────

function getTriggerToken(ctx: PieceTriggerContext): string {
  const t = ctx.auth?.accessToken ?? ctx.auth?.token;
  if (!t) throw new Error('No access token available');
  return t;
}

interface RawMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
  labelIds?: string[];
  snippet?: string;
}

async function fetchFullMessage(tok: string, id: string): Promise<RawMessage> {
  return gmailFetch(tok, `/users/me/messages/${id}?format=full`) as Promise<RawMessage>;
}

async function fetchRawMessage(tok: string, id: string): Promise<RawMessage & { raw: string }> {
  return gmailFetch(tok, `/users/me/messages/${id}?format=raw`) as Promise<RawMessage & { raw: string }>;
}

async function fetchThread(tok: string, threadId: string): Promise<unknown> {
  return gmailFetch(tok, `/users/me/threads/${threadId}?format=full`);
}

/** Decode base64url to UTF-8 string */
function decodeB64(data: string): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

/** Extract attachments from a MIME part tree */
interface ParsedAttachment { filename: string; mimeType: string; attachmentId?: string; size: number }

function extractAttachments(part: GmailPart, result: ParsedAttachment[] = []): ParsedAttachment[] {
  const p = part as GmailPart & { filename?: string; body?: { attachmentId?: string; size?: number; data?: string } };
  if (p.filename && p.body?.attachmentId) {
    result.push({ filename: p.filename, mimeType: p.mimeType ?? '', attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
  }
  if (part.parts) for (const sub of part.parts) extractAttachments(sub, result);
  return result;
}

function buildMessageOutput(msg: RawMessage): Record<string, unknown> {
  const headers: GmailHeader[] = (msg.payload as unknown as { headers?: GmailHeader[] })?.headers ?? [];
  const hm = Object.fromEntries(headers.map(h => [h.name.toLowerCase(), h.value]));
  const { text, html } = msg.payload ? extractBodyParts(msg.payload) : {};
  const attachments = msg.payload ? extractAttachments(msg.payload) : [];
  return {
    id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds, snippet: msg.snippet,
    from: hm['from'], to: hm['to'], cc: hm['cc'], bcc: hm['bcc'],
    subject: hm['subject'], date: hm['date'], messageId: hm['message-id'],
    replyTo: hm['reply-to'], inReplyTo: hm['in-reply-to'], references: hm['references'],
    body_text: text, body_html: html,
    attachments,
  };
}

function buildQueryFromProps(p: Record<string, unknown>): string {
  const parts: string[] = [];
  if ((p.from as string)?.trim()) parts.push(`from:(${(p.from as string).trim()})`);
  if ((p.to as string)?.trim()) parts.push(`to:(${(p.to as string).trim()})`);
  if ((p.subject as string)?.trim()) parts.push(`subject:(${(p.subject as string).trim()})`);
  if ((p.label as { name: string } | undefined)?.name) parts.push(`label:${(p.label as { name: string }).name}`);
  if ((p.category as string)?.trim()) parts.push(`category:${(p.category as string).trim()}`);
  return parts.join(' ');
}

// ─── Trigger: New Email ───────────────────────────────────────────────────────

async function newEmailTriggerRun(ctx: PieceTriggerContext): Promise<unknown[]> {
  const tok = getTriggerToken(ctx);
  const p = ctx.props ?? {};
  const lastMs = ctx.lastPollMs ?? 0;
  const maxResults = lastMs === 0 ? 5 : 20;
  const afterSec = Math.floor(lastMs / 1000);

  const qParts: string[] = [buildQueryFromProps(p)];
  if (afterSec > 0) qParts.push(`after:${afterSec}`);
  const q = qParts.filter(Boolean).join(' ');

  const qs = new URLSearchParams({ maxResults: String(maxResults), ...(q ? { q } : {}) });
  const list = await gmailFetch(tok, `/users/me/messages?${qs}`) as { messages?: Array<{ id: string; threadId: string }> };
  const messages = (list.messages ?? []).slice().reverse();

  const results: unknown[] = [];
  for (const { id, threadId } of messages) {
    try {
      const msg = await fetchFullMessage(tok, id);
      if (lastMs > 0 && Number(msg.internalDate) <= lastMs) continue;
      const thread = await fetchThread(tok, threadId);
      results.push({ message: buildMessageOutput(msg), thread });
    } catch { /* skip un-fetchable messages */ }
  }
  return results;
}

// ─── Trigger: New Labeled Email ───────────────────────────────────────────────

interface HistoryResponse {
  history?: Array<{
    id?: string | number;
    labelsAdded?: Array<{ labelIds?: string[]; message?: { id: string; threadId: string } }>;
    messagesAdded?: Array<{ message?: { id: string; threadId: string; labelIds?: string[] } }>;
  }>;
  historyId?: string;
}

async function newLabeledEmailTriggerRun(ctx: PieceTriggerContext): Promise<unknown[]> {
  const tok = getTriggerToken(ctx);
  const p = ctx.props ?? {};
  const labelId = (p.label as { id: string } | undefined)?.id;
  const labelName = (p.label as { name: string } | undefined)?.name ?? '';
  if (!labelId) return [];

  // lastPollMs doubles as the stored historyId epoch — callers should also
  // persist historyId themselves; we use the profile historyId as seed.
  const lastHistoryId = p.lastHistoryId as string | undefined;
  if (!lastHistoryId) {
    // Seed: return up to 5 recent messages with this label
    const qs = new URLSearchParams({ labelIds: labelId, maxResults: '5' });
    const list = await gmailFetch(tok, `/users/me/messages?${qs}`) as { messages?: Array<{ id: string }> };
    const results: unknown[] = [];
    for (const { id } of list.messages ?? []) {
      try {
        const msg = await fetchFullMessage(tok, id);
        const thread = await fetchThread(tok, msg.threadId);
        results.push({ message: buildMessageOutput(msg), thread, labelInfo: { labelId, labelName, addedAt: Date.now() } });
      } catch { /* skip */ }
    }
    return results;
  }

  const qs = new URLSearchParams({ startHistoryId: lastHistoryId, labelId, historyTypes: 'labelAdded' });
  qs.append('historyTypes', 'messageAdded');
  const hist = await gmailFetch(tok, `/users/me/history?${qs}`) as HistoryResponse;
  const seen = new Map<string, string>();

  for (const h of hist.history ?? []) {
    for (const la of h.labelsAdded ?? []) {
      if (la.labelIds?.includes(labelId) && la.message?.id) seen.set(la.message.id, String(h.id ?? ''));
    }
    for (const ma of h.messagesAdded ?? []) {
      if (ma.message?.labelIds?.includes(labelId) && ma.message?.id) seen.set(ma.message.id, String(h.id ?? ''));
    }
  }

  const results: unknown[] = [];
  for (const [msgId] of seen) {
    try {
      const msg = await fetchFullMessage(tok, msgId);
      const thread = await fetchThread(tok, msg.threadId);
      results.push({ message: buildMessageOutput(msg), thread, labelInfo: { labelId, labelName, addedAt: Date.now() } });
    } catch { /* skip */ }
  }
  return results;
}

// ─── Trigger: New Attachment ──────────────────────────────────────────────────

async function newAttachmentTriggerRun(ctx: PieceTriggerContext): Promise<unknown[]> {
  const tok = getTriggerToken(ctx);
  const p = ctx.props ?? {};
  const lastMs = ctx.lastPollMs ?? 0;
  const maxResults = lastMs === 0 ? 5 : 20;
  const afterSec = Math.floor(lastMs / 1000);

  const qParts = ['has:attachment', buildQueryFromProps(p)];
  const ext = (p.filenameExtension as string)?.trim();
  if (ext) qParts.push(`filename:${ext}`);
  if (afterSec > 0) qParts.push(`after:${afterSec}`);
  const q = qParts.filter(Boolean).join(' ');

  const qs = new URLSearchParams({ q, maxResults: String(maxResults) });
  const list = await gmailFetch(tok, `/users/me/messages?${qs}`) as { messages?: Array<{ id: string }> };
  const messages = (list.messages ?? []).slice().reverse();

  const results: unknown[] = [];
  for (const { id } of messages) {
    try {
      const msg = await fetchFullMessage(tok, id);
      if (lastMs > 0 && Number(msg.internalDate) <= lastMs) continue;
      const attachments = msg.payload ? extractAttachments(msg.payload) : [];
      for (const attachment of attachments) {
        results.push({ attachment, message: buildMessageOutput(msg) });
      }
    } catch { /* skip */ }
  }
  return results;
}

// ─── Trigger: New Conversation ────────────────────────────────────────────────

async function newConversationTriggerRun(ctx: PieceTriggerContext): Promise<unknown[]> {
  const tok = getTriggerToken(ctx);
  const p = ctx.props ?? {};
  const lastHistoryId = p.lastHistoryId as string | undefined;

  if (!lastHistoryId) {
    // Seed: fetch up to 5 recent INBOX threads
    const maxAgeHours = (p.maxAgeHours as number) ?? 24;
    const afterSec = Math.floor((Date.now() - maxAgeHours * 3600 * 1000) / 1000);
    const qParts = [`after:${afterSec}`];
    if ((p.from as string)?.trim()) qParts.push(`from:(${(p.from as string).trim()})`);
    if ((p.subject as string)?.trim()) qParts.push(`subject:(${(p.subject as string).trim()})`);
    const qs = new URLSearchParams({ q: qParts.join(' '), maxResults: '5' });
    const list = await gmailFetch(tok, `/users/me/threads?${qs}`) as { threads?: Array<{ id: string }> };
    const results: unknown[] = [];
    for (const { id } of list.threads ?? []) {
      try {
        const thread = await fetchThread(tok, id) as Record<string, unknown>;
        results.push({ threadId: id, thread });
      } catch { /* skip */ }
    }
    return results;
  }

  const qs = new URLSearchParams({ startHistoryId: lastHistoryId, historyTypes: 'messageAdded', maxResults: '100' });
  const hist = await gmailFetch(tok, `/users/me/history?${qs}`) as HistoryResponse;
  const newThreads = new Set<string>();
  const processedThreads = new Set<string>(((p.processedThreadIds as string[]) ?? []));

  for (const h of hist.history ?? []) {
    for (const ma of h.messagesAdded ?? []) {
      const threadId = ma.message?.threadId;
      if (threadId && !processedThreads.has(threadId)) newThreads.add(threadId);
    }
  }

  const results: unknown[] = [];
  for (const threadId of newThreads) {
    try {
      const thread = await fetchThread(tok, threadId) as Record<string, unknown>;
      const msgs = (thread as Record<string, unknown[]>).messages ?? [];
      if ((msgs as RawMessage[]).length === 1) {
        // Only 1 message → genuinely new conversation
        results.push({ threadId, thread });
      }
    } catch { /* skip */ }
  }
  return results;
}

// ─── Trigger: New Label ───────────────────────────────────────────────────────

async function newLabelTriggerRun(ctx: PieceTriggerContext): Promise<unknown[]> {
  const tok = getTriggerToken(ctx);
  const p = ctx.props ?? {};
  const knownIds = new Set<string>((p.knownLabelIds as string[]) ?? []);

  const labels = await fetchLabels(tok);
  if (knownIds.size === 0) return labels; // seed: return all current labels
  return labels.filter(l => l.id && !knownIds.has(l.id));
}

// ─── Piece definition ─────────────────────────────────────────────────────────

export const gmailPiece = createPiece({
  name: 'gmail',
  displayName: 'Gmail',
  description: 'Send and manage emails via Gmail OAuth2.',
  version: '0.2.0',
  auth: {
    type: 'oauth2',
    authorizationUrl: GMAIL_AUTH_URL,
    tokenUrl: GMAIL_TOKEN_URL,
    scopes: GMAIL_SCOPES,
    clientIdEnvKey: 'GMAIL_CLIENT_ID',
    clientSecretEnvKey: 'GMAIL_CLIENT_SECRET',
  },
  actions: [
    { name: 'send_email', displayName: 'Send Email', description: 'Send an email through a Gmail account', run: sendEmail },
    { name: 'request_approval_in_mail', displayName: 'Request Approval in Email', description: 'Send approval request email and wait for approve/disapprove', run: requestApprovalInMail },
    { name: 'reply_to_email', displayName: 'Reply to Email', description: 'Reply to an existing email.', run: replyToEmail },
    { name: 'create_draft_reply', displayName: 'Create Draft Reply', description: 'Creates a draft reply to an existing email.', run: createDraftReply },
    { name: 'gmail_get_mail', displayName: 'Get Email', description: 'Get an email via Id.', run: getMail },
    { name: 'gmail_get_thread', displayName: 'Get Thread', description: 'Get a Gmail thread and all its messages via thread Id.', run: getThread },
    { name: 'gmail_search_mail', displayName: 'Find Email', description: 'Find emails using advanced search criteria.', run: searchMail },
    { name: 'custom_api_call', displayName: 'Custom API Call', description: 'Make a custom authenticated call to the Gmail API.', run: customApiCall },
  ],
  triggers: [
    {
      name: 'gmail_new_email_received',
      displayName: 'New Email',
      description: 'Poll for new emails matching optional from/to/subject/label/category filters.',
      type: 'POLLING',
      run: newEmailTriggerRun,
    },
    {
      name: 'new_labeled_email',
      displayName: 'New Labeled Email',
      description: 'Poll for emails where a specific label was added (uses Gmail History API).',
      type: 'POLLING',
      run: newLabeledEmailTriggerRun,
    },
    {
      name: 'new_attachment',
      displayName: 'New Attachment',
      description: 'Poll for emails that contain attachments.',
      type: 'POLLING',
      run: newAttachmentTriggerRun,
    },
    {
      name: 'new_conversation',
      displayName: 'New Conversation',
      description: 'Poll for newly started email threads (first message in a thread).',
      type: 'POLLING',
      run: newConversationTriggerRun,
    },
    {
      name: 'new_label',
      displayName: 'New Label',
      description: 'Poll for newly created Gmail labels.',
      type: 'POLLING',
      run: newLabelTriggerRun,
    },
  ],
});
