import { createPiece } from '../framework/piece';
import type { Env, PieceActionContext, PropDefinition } from '../framework/types';

const DEFAULT_QUEUE_BINDING = 'QUEUE';
const CONTENT_TYPES = new Set<QueueContentType>(['text', 'bytes', 'json', 'v8']);

const queueBindingProp: PropDefinition = {
  type: 'SHORT_TEXT',
  displayName: 'Queue binding name',
  description: `Worker binding name for the Cloudflare Queue producer. Defaults to ${DEFAULT_QUEUE_BINDING}.`,
  required: false,
  defaultValue: DEFAULT_QUEUE_BINDING,
};

function getProps(ctx: PieceActionContext): Record<string, unknown> {
  return ctx.props ?? {};
}

function readOptionalString(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readDelaySeconds(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('delaySeconds must be a non-negative number');
  }
  return Math.trunc(value);
}

function readContentType(value: unknown): QueueContentType | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !CONTENT_TYPES.has(value as QueueContentType)) {
    throw new Error('contentType must be one of: text, bytes, json, v8');
  }
  return value as QueueContentType;
}

function getQueue(env: Env, props: Record<string, unknown>): Queue {
  const bindingName = readOptionalString(props, 'queueBinding') ?? DEFAULT_QUEUE_BINDING;
  const binding = env[bindingName] as Queue | undefined;
  if (!binding || typeof binding.send !== 'function' || typeof binding.sendBatch !== 'function') {
    throw new Error(`Queue binding "${bindingName}" was not found`);
  }
  return binding;
}

function readMessageRequest(value: unknown): MessageSendRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('body' in value)) {
    return { body: value };
  }

  const raw = value as Record<string, unknown>;
  return {
    body: raw['body'],
    contentType: readContentType(raw['contentType']),
    delaySeconds: readDelaySeconds(raw['delaySeconds']),
  };
}

async function sendMessage(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const queue = getQueue(ctx.env, props);
  await queue.send(props['body'], {
    contentType: readContentType(props['contentType']),
    delaySeconds: readDelaySeconds(props['delaySeconds']),
  });
  return { sent: true };
}

async function sendBatch(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const messages = props['messages'];
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const queue = getQueue(ctx.env, props);
  const batch = messages.map(readMessageRequest);
  await queue.sendBatch(batch, { delaySeconds: readDelaySeconds(props['delaySeconds']) });
  return { sent: batch.length };
}

export const cloudflareQueuePiece = createPiece({
  name: 'cloudflare-queue',
  displayName: 'Cloudflare Queue',
  description: 'Send messages to a Cloudflare Queue producer binding.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [
    {
      name: 'send_message',
      displayName: 'Send Message',
      description: 'Send one message to a Cloudflare Queue.',
      props: {
        queueBinding: queueBindingProp,
        body: { type: 'JSON', displayName: 'Message body', required: false },
        contentType: { type: 'SHORT_TEXT', displayName: 'Content type', required: false },
        delaySeconds: { type: 'NUMBER', displayName: 'Delay seconds', required: false },
      },
      run: sendMessage,
    },
    {
      name: 'send_batch',
      displayName: 'Send Batch',
      description: 'Send a batch of messages to a Cloudflare Queue.',
      props: {
        queueBinding: queueBindingProp,
        messages: {
          type: 'JSON',
          displayName: 'Messages',
          description: 'Array of message bodies or { body, contentType, delaySeconds } objects.',
          required: true,
        },
        delaySeconds: { type: 'NUMBER', displayName: 'Batch delay seconds', required: false },
      },
      run: sendBatch,
    },
  ],
});
