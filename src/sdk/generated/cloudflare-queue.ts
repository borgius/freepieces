// Hand-written types for the native cloudflare-queue piece.

export type CloudflareQueueContentType = 'text' | 'bytes' | 'json' | 'v8';

export interface CloudflareQueueBindingInput {
  /** Worker Queue producer binding name. Defaults to QUEUE. */
  queueBinding?: string;
}

export interface CloudflareQueueSendMessageInput extends CloudflareQueueBindingInput {
  body?: unknown;
  contentType?: CloudflareQueueContentType;
  delaySeconds?: number;
}

export interface CloudflareQueueBatchMessage {
  body: unknown;
  contentType?: CloudflareQueueContentType;
  delaySeconds?: number;
}

export interface CloudflareQueueSendBatchInput extends CloudflareQueueBindingInput {
  messages: Array<unknown | CloudflareQueueBatchMessage>;
  delaySeconds?: number;
}

export interface CloudflareQueueSendMessageOutput {
  sent: true;
}

export interface CloudflareQueueSendBatchOutput {
  sent: number;
}

export interface CloudflareQueueClient {
  /** Send one message to a Cloudflare Queue. */
  send_message(input?: CloudflareQueueSendMessageInput): Promise<CloudflareQueueSendMessageOutput>;
  /** Send a batch of messages to a Cloudflare Queue. */
  send_batch(input: CloudflareQueueSendBatchInput): Promise<CloudflareQueueSendBatchOutput>;
}
