/**
 * Script client — demonstrates how to call freepieces actions from a Node.js
 * or Deno script using a predefined bearer token.
 *
 * Usage
 * ─────
 *   FREEPIECES_URL=https://freepieces.example.workers.dev \
 *   FREEPIECES_TOKEN=my-secret-token \
 *   node --import tsx src/client/script-client.ts
 *
 * Or with ts-node:
 *   FREEPIECES_URL=... FREEPIECES_TOKEN=... npx ts-node src/client/script-client.ts
 *
 * Environment variables
 * ─────────────────────
 *   FREEPIECES_URL    Base URL of the deployed worker (default: http://localhost:8787)
 *   FREEPIECES_TOKEN  Bearer token / predefined API key
 */

const BASE_URL = process.env['FREEPIECES_URL'] ?? 'http://localhost:8787';
const TOKEN = process.env['FREEPIECES_TOKEN'] ?? '';

async function callAction(
  pieceName: string,
  actionName: string,
  props: Record<string, unknown> = {}
): Promise<unknown> {
  const url = `${BASE_URL}/run/${pieceName}/${actionName}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {})
    },
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
  console.log('Token configured:', TOKEN ? 'yes' : 'no (set FREEPIECES_TOKEN)');
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
