/**
 * Minimal Cloudflare Queue consumer for the "slack-new-message" queue.
 *
 * Receives messages dispatched by freepieces when a Slack webhook matches a
 * subscription with queueName = "slack-new-message" and logs them to Workers
 * log (visible via `npx wrangler tail freepieces-queue-consumer`).
 *
 * Deploy:
 *   npx wrangler deploy --config wrangler-consumer.toml
 *
 * Watch:
 *   npx wrangler tail freepieces-queue-consumer --format=pretty
 */

export interface QueueMessage {
  piece: string;
  trigger: string;
  events: unknown[];
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    _env: unknown,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log(`[queue-consumer] Received batch of ${batch.messages.length} message(s)`);
    for (const msg of batch.messages) {
      const body = msg.body;
      console.log('[queue-consumer] ─────────────────────────────────────────');
      console.log(`[queue-consumer] piece:   ${body.piece}`);
      console.log(`[queue-consumer] trigger: ${body.trigger}`);
      console.log(`[queue-consumer] events:  ${JSON.stringify(body.events, null, 2)}`);
      msg.ack();
    }
    console.log('[queue-consumer] Batch processed ✓');
  },
};
