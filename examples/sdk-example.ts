/**
 * freepieces SDK — usage examples
 *
 * Run with static API key:
 *   FREEPIECES_URL=https://freepieces.example.workers.dev \
 *   FREEPIECES_RUN_API_KEY=fp_sk_<your-key> \
 *   USER_ID=alice@example.com \
 *   node --import tsx examples/sdk-example.ts
 *
 * Run with OpenAuth access token:
 *   FREEPIECES_URL=https://freepieces.example.workers.dev \
 *   ACCESS_TOKEN=<openauth-jwt> \
 *   node --import tsx examples/sdk-example.ts
 *
 * Local dev (no FREEPIECES_RUN_API_KEY — worker runs without the gating secret):
 *   FREEPIECES_URL=http://localhost:9321 USER_ID=alice npx tsx examples/sdk-example.ts
 */

import { createClient } from '../src/sdk/index.js';
import type { CloudflareD1Result, CloudflareR2GetObjectOutput, GmailMessage, GmailSearchResult } from '../src/sdk/index.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

const client = createClient({
  baseUrl: process.env['FREEPIECES_URL'] ?? 'http://localhost:9321',
  // Option 1: Static API key + user ID (M2M)
  // Option 2: OpenAuth access token (JWT from /oa flow)
  // Option 3: Local dev — only USER_ID needed as bearer fallback
  token:       process.env['FREEPIECES_RUN_API_KEY'] ?? process.env['FP_RUN_API_KEY'] ?? process.env['RUN_API_KEY'],
  accessToken: process.env['ACCESS_TOKEN'],
  userId:      process.env['USER_ID'],
});

async function main(): Promise<void> {
  // ── List all registered pieces ────────────────────────────────────────────
  const pieces = await client.listPieces();
  console.log('Registered pieces:', pieces.map(p => p.name));

  // ── Gmail ─────────────────────────────────────────────────────────────────

  // Send an email (fully typed)
  await client.gmail.send_email({
    receiver:  ['alice@example.com'],
    subject:   'Hello from freepieces SDK',
    body:      'It works!',
    body_type: 'plain_text',
  });

  // Search for emails
  const search: GmailSearchResult = await client.gmail.gmail_search_mail({
    subject:  'invoice',
    from:     'billing@example.com',
    max_results: 5,
  });
  console.log('Found emails:', search.results.count);

  // Get a single message
  const msg: GmailMessage = await client.gmail.gmail_get_mail({
    message_id: 'msg-id-here',
  });
  console.log('Subject:', msg.subject);

  // Reply
  await client.gmail.reply_to_email({
    message_id: msg.id,
    body:       'Thanks!',
    reply_type: 'reply',
  });

  // ── Slack ─────────────────────────────────────────────────────────────────

  // Post a channel message
  await client.slack.send_channel_message({
    channel:   'general',
    text:      'Deployed successfully! 🚀',
    sendAsBot: true,
  });

  // Send a DM
  await client.slack.send_direct_message({
    userId: 'U0123456789',
    text:   'Hey, your report is ready.',
  });

  // Search Slack messages
  await client.slack.searchMessages({ query: 'deployment failed' });

  // ── Example API-key piece ─────────────────────────────────────────────────

  const pong = await client['example-apikey'].ping({ hello: 'world' });
  console.log('Ping result:', pong.ok, 'at', pong.timestamp);

  const echo = await client['example-apikey'].echo({ message: 'hello' });
  console.log('Echo:', echo.echo);

  // ── Cloudflare D1 and R2 bindings ─────────────────────────────────────────

  const rows: CloudflareD1Result = await client['cloudflare-d1'].query({
    sql: 'select * from users where id = ?',
    // Replace the placeholder with your own application value or set USER_ID.
    params: [process.env['USER_ID'] ?? 'your-user-id'],
  });
  console.log('D1 rows:', rows.results.length);

  await client['cloudflare-r2'].put_object({
    key: 'notes/hello.txt',
    value: 'hello',
    contentType: 'text/plain',
  });

  const object: CloudflareR2GetObjectOutput = await client['cloudflare-r2'].get_object({
    key: 'notes/hello.txt',
  });
  console.log('R2 object found:', object.found);

  // ── Generic escape-hatch (any piece, any action) ──────────────────────────

  const result = await client.run('my-custom-piece', 'my-action', { foo: 'bar' });
  console.log('Custom result:', result);

  // ── Dynamic piece accessor ────────────────────────────────────────────────

  interface MyPiece {
    greet(input: { name: string }): Promise<{ greeting: string }>;
  }
  const myPiece = client.piece<MyPiece>('my-piece');
  const greeting = await myPiece.greet({ name: 'World' });
  console.log(greeting.greeting);
}

main().catch(console.error);
