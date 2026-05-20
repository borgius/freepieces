/**
 * Example API-key piece — demonstrates the native freepieces piece model with
 * API-key authentication.
 *
 * Script clients supply the key via:
 *   Authorization: Bearer <key>
 */

import { createPiece } from '../framework/piece';

export const exampleApiKeyPiece = createPiece({
  name: 'example-apikey',
  displayName: 'Example API-Key Piece',
  description: 'Demonstrates API-key authentication, simple actions, and both trigger types.',
  version: '0.1.0',
  auth: {
    type: 'apiKey',
    headerName: 'Authorization'
  },
  actions: [
    {
      name: 'ping',
      displayName: 'Ping',
      description: 'Returns a success payload confirming the piece is reachable.',
      async run(ctx) {
        return {
          ok: true,
          authConfigured: Boolean(ctx.auth?.token),
          props: ctx.props ?? {},
          timestamp: new Date().toISOString()
        };
      }
    },
    {
      name: 'echo',
      displayName: 'Echo',
      description: 'Echoes back any props passed to the action.',
      async run(ctx) {
        return { echo: ctx.props ?? {} };
      }
    }
  ],
  triggers: [
    {
      name: 'poll_tick',
      displayName: 'Poll Tick',
      description: 'Fires once per polling cycle — emits a synthetic test event with timing metadata. Useful for verifying polling trigger delivery end-to-end.',
      type: 'POLLING',
      async run(ctx) {
        const now = Date.now();
        return [{
          event: 'poll_tick',
          message: 'Example polling trigger fired',
          polledAt: new Date(now).toISOString(),
          lastPolledAt: ctx.lastPollMs ? new Date(ctx.lastPollMs).toISOString() : null,
          elapsedMs: ctx.lastPollMs ? now - ctx.lastPollMs : null,
        }];
      }
    },
    {
      name: 'inbound_webhook',
      displayName: 'Inbound Webhook',
      description: 'Passes through any HTTP payload sent to the piece\'s inbound webhook URL as a trigger event.',
      type: 'WEBHOOK',
      async run(ctx) {
        // ctx carries the inbound payload injected by the webhook dispatcher
        const payload = (ctx as unknown as Record<string, unknown>)['payload'];
        return payload ? [payload] : [];
      }
    }
  ]
});
