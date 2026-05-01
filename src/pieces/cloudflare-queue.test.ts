import { describe, expect, it } from 'vitest';

import { cloudflareQueuePiece } from './cloudflare-queue';
import type { Env } from '../framework/types';

class FakeQueue {
  sent: Array<{ body: unknown; options?: QueueSendOptions }> = [];
  batches: Array<{ messages: MessageSendRequest[]; options?: QueueSendBatchOptions }> = [];

  async send(body: unknown, options?: QueueSendOptions): Promise<void> {
    this.sent.push({ body, options });
  }

  async sendBatch(messages: Iterable<MessageSendRequest>, options?: QueueSendBatchOptions): Promise<void> {
    this.batches.push({ messages: [...messages], options });
  }
}

function createEnv(queue = new FakeQueue()): Env {
  return { QUEUE: queue } as unknown as Env;
}

function getAction(name: string) {
  const action = cloudflareQueuePiece.actions.find((entry) => entry.name === name);
  if (!action) throw new Error(`Missing action ${name}`);
  return action;
}

describe('cloudflareQueuePiece', () => {
  it('defines a no-auth Cloudflare Queue piece', () => {
    expect(cloudflareQueuePiece.name).toBe('cloudflare-queue');
    expect(cloudflareQueuePiece.auth.type).toBe('none');
    expect(cloudflareQueuePiece.actions.map((action) => action.name)).toEqual(['send_message', 'send_batch']);
  });

  it('sends one message through the default QUEUE binding', async () => {
    const queue = new FakeQueue();
    const result = await getAction('send_message').run({
      env: createEnv(queue),
      props: { body: { id: 'msg-1' }, contentType: 'json', delaySeconds: 3.8 },
    });

    expect(result).toEqual({ sent: true });
    expect(queue.sent).toEqual([
      { body: { id: 'msg-1' }, options: { contentType: 'json', delaySeconds: 3 } },
    ]);
  });

  it('sends batches and normalizes body-only entries', async () => {
    const queue = new FakeQueue();
    const result = await getAction('send_batch').run({
      env: createEnv(queue),
      props: {
        messages: [
          { body: { id: 'msg-1' }, contentType: 'json', delaySeconds: 1 },
          'plain body',
        ],
        delaySeconds: 2,
      },
    });

    expect(result).toEqual({ sent: 2 });
    expect(queue.batches).toEqual([{
      messages: [
        { body: { id: 'msg-1' }, contentType: 'json', delaySeconds: 1 },
        { body: 'plain body' },
      ],
      options: { delaySeconds: 2 },
    }]);
  });

  it('can use a custom Queue binding', async () => {
    const queue = new FakeQueue();
    const env = { TASK_QUEUE: queue } as unknown as Env;

    await getAction('send_message').run({
      env,
      props: { queueBinding: 'TASK_QUEUE', body: 'work' },
    });

    expect(queue.sent[0]?.body).toBe('work');
  });

  it('rejects invalid content types', async () => {
    await expect(getAction('send_message').run({
      env: createEnv(),
      props: { body: 'work', contentType: 'xml' },
    })).rejects.toThrow('contentType must be one of');
  });

  it('throws when the requested binding is missing', async () => {
    await expect(getAction('send_message').run({
      env: createEnv(),
      props: { queueBinding: 'MISSING_QUEUE', body: 'work' },
    })).rejects.toThrow('Queue binding "MISSING_QUEUE" was not found');
  });
});
