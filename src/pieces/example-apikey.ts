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
  description: 'Demonstrates API-key authentication and a simple action.',
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
  ]
});
