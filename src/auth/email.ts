/**
 * Email delivery for OpenAuth verification codes via Cloudflare Email Workers.
 *
 * Uses the `send_email` binding (EMAIL) to deliver MIME messages.
 * Falls back to console.log when the binding is absent (local dev).
 *
 * Requires:
 *   - Email Routing enabled on the domain
 *   - [[send_email]] binding configured in wrangler.toml
 *   - AUTH_SENDER_EMAIL env var set to a verified sender address on the domain
 */

import { createMimeMessage } from 'mimetext';
import type { Env } from '../framework/types';
import { getEnvStr } from '../lib/env';

/**
 * Build a plain-text + HTML verification code email.
 */
function buildCodeEmail(senderEmail: string, recipientEmail: string, code: string): string {
  const msg = createMimeMessage();
  msg.setSender({ name: 'Freepieces', addr: senderEmail });
  msg.setRecipient(recipientEmail);
  msg.setSubject(`Your verification code: ${code}`);

  msg.addMessage({
    contentType: 'text/plain',
    data: [
      `Your verification code is: ${code}`,
      '',
      'This code expires in 10 minutes.',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
  });

  msg.addMessage({
    contentType: 'text/html',
    data: [
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">',
      '<h2 style="color:#1a1a1a;margin-bottom:16px">Freepieces</h2>',
      '<p>Your verification code is:</p>',
      `<p style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#2563eb;margin:24px 0">${code}</p>`,
      '<p style="color:#666;font-size:14px">This code expires in 10 minutes.</p>',
      '<p style="color:#666;font-size:14px">If you did not request this, you can safely ignore this email.</p>',
      '</div>',
    ].join('\n'),
  });

  return msg.asRaw();
}

/**
 * Send a verification code email using Cloudflare Email Workers.
 *
 * When the EMAIL binding is not available (local dev), logs the code to console.
 */
export async function sendVerificationEmail(env: Env, recipientEmail: string, code: string) {
  const senderEmail = getEnvStr(env, 'AUTH_SENDER_EMAIL') ?? '';
  const emailBinding = (
    (env as Record<string, unknown>)['FREEPIECES_EMAIL'] ??
    (env as Record<string, unknown>)['FP_EMAIL'] ??
    (env as Record<string, unknown>)['EMAIL']
  ) as { send: (msg: unknown) => Promise<void> } | undefined;

  if (!emailBinding || !senderEmail) {
    console.log(`[freepieces-auth] Verification code for ${recipientEmail}: ${code}`);
    return;
  }

  const rawMessage = buildCodeEmail(senderEmail, recipientEmail, code);

  // Cloudflare EmailMessage constructor: (from, to, rawMessage)
  // We import it dynamically because it only exists in the Workers runtime.
  const { EmailMessage } = await import('cloudflare:email');
  const message = new EmailMessage(senderEmail, recipientEmail, rawMessage);

  await emailBinding.send(message);
}
