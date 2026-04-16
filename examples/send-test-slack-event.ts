/**
 * Send a real Slack message via freepieces /run/slack/send_channel_message.
 *
 * This is the SEND side of the E2E queue test:
 *   1. This script  → POST /run/slack/send_channel_message → message appears in Slack
 *   2. Slack Events API → POST /webhook/slack on freepieces worker
 *   3. Worker runs new-message trigger filter → pushes matched event to queue
 *   4. Consumer worker receives from queue → logs it (visible via wrangler tail)
 *
 * Required env vars (from .env):
 *   FREEPIECES_PUBLIC_URL   base URL of the deployed worker
 *   RUN_API_KEY             runtime auth key
 *   SLACK_BOT_TOKEN         xoxb-... bot token
 *   SLACK_CHANNEL           channel ID to post to
 *   SLACK_USER_ID           user ID for runtime auth headers
 *
 * Usage:
 *   npx tsx examples/send-test-slack-event.ts
 *   MSG="Custom text" npx tsx examples/send-test-slack-event.ts
 */

import 'dotenv/config';

const BASE_URL    = process.env['FREEPIECES_PUBLIC_URL'] ?? process.env['FREEPIECES_URL'] ?? 'http://localhost:9321';
const RUN_API_KEY = process.env['RUN_API_KEY'] ?? '';
const BOT_TOKEN   = process.env['SLACK_BOT_TOKEN'] ?? '';
const CHANNEL     = process.env['SLACK_CHANNEL'] ?? '';
const USER_ID     = process.env['SLACK_USER_ID'] ?? '';
const MSG_TEXT    = process.env['MSG'] ?? `E2E queue test at ${new Date().toISOString()}`;

if (!BOT_TOKEN) { console.error('Error: SLACK_BOT_TOKEN is required in .env'); process.exit(1); }
if (!CHANNEL)   { console.error('Error: SLACK_CHANNEL is required in .env');   process.exit(1); }

// Build runtime auth headers (same pattern as slack-example.ts)
// Use a dedicated user-id with no stored OAuth tokens in KV so the bot token
// (X-Piece-Token) is used directly instead of an expired stored OAuth token.
const headers: Record<string, string> = { 'content-type': 'application/json' };
if (RUN_API_KEY) {
  headers.authorization = `Bearer ${RUN_API_KEY}`;
  headers['x-user-id']     = 'e2e-bot';
  if (BOT_TOKEN) headers['x-piece-token']  = BOT_TOKEN;
} else {
  headers.authorization = `Bearer ${BOT_TOKEN}`;
}

const url = `${BASE_URL}/run/slack/send_channel_message`;

console.log(`\n  → POST ${url}`);
console.log(`  channel: ${CHANNEL}`);
console.log(`  text:    ${MSG_TEXT}\n`);

const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ channel: CHANNEL, text: MSG_TEXT, sendAsBot: true }),
});

const body = await res.json() as { ok: boolean; result?: unknown; error?: string };

if (body.ok) {
  console.log('  ✓ Message sent to Slack!');
  console.log(`  Result: ${JSON.stringify(body.result, null, 2)}\n`);
  console.log('  Now watch the queue consumer for the echo back from Slack Events API:');
  console.log('    npx wrangler tail freepieces-queue-consumer --format=pretty\n');
} else {
  console.error(`  ✗ Send failed: ${body.error ?? res.status}`);
  process.exit(1);
}
