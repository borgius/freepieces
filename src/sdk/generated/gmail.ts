// Types for the native gmail piece (direct REST API integration).
// Re-exports AP gmail types and adds native-only actions.

export type { GmailClient as NpmGmailClient } from './npm-gmail.js';

// ── Shared output shapes ──────────────────────────────────────────────────

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
  labels?: string[];
  [key: string]: unknown;
}

export interface GmailSearchResult {
  found: boolean;
  results: { messages: GmailMessage[]; count: number };
}

export type GmailBodyType = 'plain_text' | 'html';

export interface GmailComposeOptions {
  from?: string;
  sender_name?: string;
  subject: string;
  body: string;
  body_type?: GmailBodyType;
}

// ── Action inputs ─────────────────────────────────────────────────────────

export interface GmailSendEmailInput {
  /** Sender email override (defaults to authenticated user). */
  from?: string;
  /** Display name of the sender. */
  sender_name?: string;
  /** List of recipient email addresses. */
  receiver: string[];
  /** CC recipients. */
  cc?: string[];
  /** BCC recipients. */
  bcc?: string[];
  /** Reply-To addresses. */
  reply_to?: string[];
  /** Email subject line. */
  subject: string;
  /** Email body. */
  body: string;
  /** Body format — plain_text or html. */
  body_type?: GmailBodyType;
  /** Message-Id to reply to (sets thread). */
  in_reply_to?: string;
  /** If true, creates a draft instead of sending. */
  draft?: boolean;
}

export interface GmailRequestApprovalInput {
  from?: string;
  sender_name?: string;
  receiver: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string;
  body: string;
  approve_url?: string;
  disapprove_url?: string;
  in_reply_to?: string;
}

export interface GmailReplyInput {
  message_id: string;
  body: string;
  body_type?: GmailBodyType;
  sender_name?: string;
  reply_type?: 'reply' | 'reply_all';
}

export interface GmailCreateDraftReplyInput {
  message_id: string;
  body?: string;
  body_type?: GmailBodyType;
  sender_name?: string;
  reply_type?: 'reply' | 'reply_all';
  include_original_message?: boolean;
}

export interface GmailGetMailInput {
  message_id: string;
}

export interface GmailGetThreadInput {
  thread_id: string;
  format?: string;
}

export interface GmailSearchMailInput {
  from?: string;
  to?: string;
  subject?: string;
  content?: string;
  has_attachment?: boolean;
  attachment_name?: string;
  label?: { name: string };
  category?: string;
  after_date?: string;
  before_date?: string;
  max_results?: number;
  include_spam_trash?: boolean;
}

export interface GmailCustomApiCallInput {
  method?: string;
  url_path: string;
  body?: Record<string, unknown>;
}

// ── Client interface ──────────────────────────────────────────────────────

export interface GmailClient {
  /** Send an email through a Gmail account. */
  send_email(input: GmailSendEmailInput): Promise<unknown>;
  /** Send approval request email and wait for approve/disapprove. */
  request_approval_in_mail(input: GmailRequestApprovalInput): Promise<unknown>;
  /** Reply to an existing email. */
  reply_to_email(input: GmailReplyInput): Promise<unknown>;
  /** Creates a draft reply to an existing email. */
  create_draft_reply(input: GmailCreateDraftReplyInput): Promise<unknown>;
  /** Get an email via Id. */
  gmail_get_mail(input: GmailGetMailInput): Promise<GmailMessage>;
  /** Get a Gmail thread and all its messages via thread Id. */
  gmail_get_thread(input: GmailGetThreadInput): Promise<unknown>;
  /** Find emails using advanced search criteria. */
  gmail_search_mail(input: GmailSearchMailInput): Promise<GmailSearchResult>;
  /** Make a custom authenticated call to the Gmail API. */
  custom_api_call(input: GmailCustomApiCallInput): Promise<unknown>;
}
