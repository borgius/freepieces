/**
 * Script client — demonstrates how to call freepieces actions from a Node.js
 * or Deno script using the current runtime-auth contract.
 *
 * Usage
 * ─────
 *   FREEPIECES_URL=https://freepieces.example.workers.dev \
 *   RUN_API_KEY=fp_sk_<your-key> \
 *   FREEPIECES_PIECE_TOKEN=my-piece-token \
 *   node --import tsx src/client/script-client.ts
 *
 * Or with ts-node:
 *   FREEPIECES_URL=... RUN_API_KEY=... FREEPIECES_PIECE_TOKEN=... npx ts-node src/client/script-client.ts
 *
 * Environment variables
 * ─────────────────────
 *   FREEPIECES_URL         Base URL of the deployed worker (default: http://localhost:8787)
 *   RUN_API_KEY            Shared worker API key (Authorization header in secured mode)
 *   FREEPIECES_USER_ID     OAuth2 KV lookup key / logical user identity
 *   FREEPIECES_PIECE_TOKEN Direct runtime piece credential for API-key/CUSTOM_AUTH pieces
 */

const BASE_URL = process.env['FREEPIECES_URL'] ?? 'http://localhost:8787';
const RUN_API_KEY = process.env['RUN_API_KEY'] ?? '';
const USER_ID = process.env['FREEPIECES_USER_ID'] ?? process.env['USER_ID'] ?? '';
const PIECE_TOKEN = process.env['FREEPIECES_PIECE_TOKEN'] ?? '';

async function callAction(
  pieceName: string,
  actionName: string,
  props: Record<string, unknown> = {}
): Promise<unknown> {
  const url = `${BASE_URL}/run/${pieceName}/${actionName}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const bearerFallback = RUN_API_KEY || PIECE_TOKEN || USER_ID;
  if (bearerFallback) {
    headers.authorization = `Bearer ${bearerFallback}`;
  }
  if (USER_ID) {
    headers['x-user-id'] = USER_ID;
  }
  if (PIECE_TOKEN) {
    headers['x-piece-token'] = PIECE_TOKEN;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(props)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function listPieces(): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/pieces`);
  return response.json();
}

async function main(): Promise<void> {
  console.log('=== freepieces script client ===\n');
  console.log('Base URL:', BASE_URL);
  console.log('RUN_API_KEY configured:', RUN_API_KEY ? 'yes' : 'no');
  console.log('User ID configured:', USER_ID ? 'yes' : 'no');
  console.log('Piece token configured:', PIECE_TOKEN ? 'yes' : 'no');
  console.log();

  // List available pieces
  console.log('Available pieces:');
  const pieces = await listPieces();
  console.log(JSON.stringify(pieces, null, 2));
  console.log();

  // Call the ping action on the API-key example piece
  console.log('Calling example-apikey/ping...');
  const pingResult = await callAction('example-apikey', 'ping', { hello: 'world' });
  console.log(JSON.stringify(pingResult, null, 2));
  console.log();

  // Call the echo action
  console.log('Calling example-apikey/echo...');
  const echoResult = await callAction('example-apikey', 'echo', { message: 'Hello from script client!' });
  console.log(JSON.stringify(echoResult, null, 2));
}

main().catch((error: unknown) => {
  console.error('Script client error:', error);
  process.exit(1);
});
