/**
 * Slack piece — actions + triggers example
 *
 * Demonstrates the full freepieces Slack integration using the zero-adapt
 * @activepieces/piece-slack piece:
 *
 *   Actions (POST /run/slack/<action>)
 *   ───────────────────────────────────
 *   • send_channel_message        — post a message to a channel
 *   • send_direct_message         — send a DM to a user
 *   • slack-add-reaction-to-message — add an emoji reaction to a message
 *
 *   Triggers (POST /trigger/slack/<trigger>)
 *   ─────────────────────────────────────────
 *   Trigger endpoints act as a filter / fan-out layer.  Your existing webhook
 *   infrastructure (Slack Events API → your server → freepieces) posts the
 *   raw Slack payload; freepieces runs the AP trigger logic and returns only
 *   the matched events.
 *
 *   • new-message          — public channel messages (excludes bots/threads by default)
 *   • new_mention          — @-mentions of the bot user
 *   • new_reaction_added   — reactions added to messages
 *
 * Prerequisites
 * ─────────────
 *   • Worker deployed:     ./deploy.sh
 *   • Bot token secret:    wrangler secret put SLACK_BOT_TOKEN
 *     (value: xoxb-... from your Slack app's OAuth page)
 *   • .env file:           cp .env.example .env  (fill in SLACK_BOT_TOKEN etc.)
 *   • Node.js ≥ 20 + tsx:  npx tsx examples/slack-example.ts
 *
 * Usage
 * ─────
 *   # All demos (actions + triggers):
 *   npx tsx examples/slack-example.ts
 *
 *   # Actions only:
 *   npx tsx examples/slack-example.ts --actions
 *
 *   # Triggers only:
 *   npx tsx examples/slack-example.ts --triggers
 *
 *   # Seed OAuth2 access+refresh tokens into KV (OAuth2 with token rotation):
 *   SLACK_ACCESS_TOKEN=xoxe-... SLACK_REFRESH_TOKEN=xoxe-r-... \
 *     ADMIN_USER=admin ADMIN_PASSWORD=secret SLACK_USER_ID=alice \
 *     npx tsx examples/slack-example.ts --seed-tokens
 *   # Then run actions with the stored tokens:
 *   SLACK_USER_ID=alice npx tsx examples/slack-example.ts --actions
 *
 *   # Register a persistent webhook subscription on the deployed worker:
 *   SLACK_CALLBACK_URL=https://your-server.example.com/events \
 *     npx tsx examples/slack-example.ts --subscribe --trigger=new-message
 *
 *   # List active subscriptions:
 *   npx tsx examples/slack-example.ts --list-subs
 *
 *   # Delete a subscription:
 *   npx tsx examples/slack-example.ts --unsubscribe --sub-id=<uuid>
 *
 *   # Wait for real Slack events locally (requires a public URL via cloudflared/ngrok):
 *   npx tsx examples/slack-example.ts --listen [--port=3000]
 *
 * Environment variables
 * ─────────────────────
 *   FREEPIECES_URL      base URL of the deployed worker
 *   RUN_API_KEY         shared runtime auth key for secured workers
 *   SLACK_CHANNEL       channel ID to post the test message in (default: general)
 *   SLACK_USER_ID       Slack user ID for DM test and KV key for stored tokens
 *
 *   Bot token auth (CUSTOM_AUTH — never expires, recommended for most apps):
 *     SLACK_BOT_TOKEN   xoxb-... bot token, sent as X-Piece-Token when RUN_API_KEY is set
 *
 *   OAuth2 with token rotation (opt-in Slack app setting, tokens expire in 12h):
 *     SLACK_ACCESS_TOKEN    xoxe-1-... current access token
 *     SLACK_REFRESH_TOKEN   xoxe-1-... refresh token
 *     SLACK_EXPIRES_IN      seconds until SLACK_ACCESS_TOKEN expires (default: 43200)
 *     ADMIN_USER            admin username (same as wrangler secret ADMIN_USER)
 *     ADMIN_PASSWORD        admin password (same as wrangler secret ADMIN_PASSWORD)
 *
 *     Run --seed-tokens once to store both tokens in KV, then use
 *     --actions / --triggers with SLACK_USER_ID as the lookup key.
 */

import 'dotenv/config';

const BASE_URL = process.env['FREEPIECES_URL'] ?? 'http://localhost:8787';
const RUN_API_KEY = process.env['RUN_API_KEY'] ?? '';
// ── Bot token auth (CUSTOM_AUTH) ──────────────────────────────────────────────
// Never expires. Sent directly as X-Piece-Token when RUN_API_KEY is enabled,
// otherwise used as the bearer fallback.
// Worker maps it to: { type: 'CUSTOM_AUTH', props: { botToken: '...' } }
const BOT_TOKEN = process.env['SLACK_BOT_TOKEN'] ?? '';

// ── OAuth2 with token rotation ─────────────────────────────────────────────────
// Tokens expire in 12h. Run --seed-tokens once to store in KV, then use
// SLACK_USER_ID for subsequent requests (worker auto-refreshes).
const ACCESS_TOKEN  = process.env['SLACK_ACCESS_TOKEN']  ?? '';
const REFRESH_TOKEN = process.env['SLACK_REFRESH_TOKEN'] ?? '';
const EXPIRES_IN    = parseInt(process.env['SLACK_EXPIRES_IN'] ?? '43200', 10);
const ADMIN_USER    = process.env['ADMIN_USER']     ?? '';
const ADMIN_PASS    = process.env['ADMIN_PASSWORD'] ?? '';

const CHANNEL       = process.env['SLACK_CHANNEL']  ?? 'C0000000000'; // replace with real channel ID
const USER_ID_SLACK = process.env['SLACK_USER_ID']  ?? 'U0000000000'; // replace with real user ID

// Legacy bearer fallback for local dev when RUN_API_KEY is not configured.
const BEARER = BOT_TOKEN || USER_ID_SLACK;

const PIECE = 'slack';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function buildRuntimeHeaders(withJson = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withJson) {
    headers['content-type'] = 'application/json';
  }

  if (RUN_API_KEY) {
    headers.authorization = `Bearer ${RUN_API_KEY}`;
    if (USER_ID_SLACK) headers['x-user-id'] = USER_ID_SLACK;
    if (BOT_TOKEN) headers['x-piece-token'] = BOT_TOKEN;
    return headers;
  }

  if (BEARER) {
    headers.authorization = `Bearer ${BEARER}`;
  }
  if (USER_ID_SLACK) headers['x-user-id'] = USER_ID_SLACK;
  if (BOT_TOKEN) headers['x-piece-token'] = BOT_TOKEN;
  return headers;
}

/**
 * Call a Slack action.
 * The bot token is sent as the Bearer token — the worker maps it to the
 * CUSTOM_AUTH shape expected by AP: { type: 'CUSTOM_AUTH', props: { botToken } }
 */
async function run(action: string, props: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/run/${PIECE}/${action}`, {
    method: 'POST',
    headers: buildRuntimeHeaders(),
    body: JSON.stringify(props),
  });
  const body = await res.json() as { ok: boolean; result?: unknown; error?: string };
  if (!body.ok) throw new Error(`Action ${action} failed: ${body.error ?? 'unknown error'}`);
  return body.result;
}

/**
 * Simulate a Slack webhook arriving at the trigger endpoint.
 *
 * In production your server receives the real Slack Events API POST, then
 * forwards it here as `payload`.  The `propsValue` object holds any user-
 * configured filter props (e.g. which channel to watch).
 *
 * @param triggerName  AP trigger name, e.g. 'new-message'
 * @param payload      Raw Slack Events API payload (the full JSON body Slack sends)
 * @param propsValue   Optional filter config known at trigger-setup time
 */
async function trigger(
  triggerName: string,
  payload: unknown,
  propsValue: Record<string, unknown> = {},
): Promise<unknown[]> {
  const res = await fetch(`${BASE_URL}/trigger/${PIECE}/${triggerName}`, {
    method: 'POST',
    headers: buildRuntimeHeaders(),
    body: JSON.stringify({ payload, propsValue }),
  });
  const body = await res.json() as { ok: boolean; events?: unknown[]; error?: string };
  if (!body.ok) throw new Error(`Trigger ${triggerName} failed: ${body.error ?? 'unknown error'}`);
  return body.events ?? [];
}

// ─── Seed OAuth2 tokens ──────────────────────────────────────────────────────

/**
 * Seed an access+refresh token pair directly into KV via the admin endpoint.
 * Only needed once when using OAuth2 with token rotation.
 * After seeding, use SLACK_USER_ID for all subsequent /run calls.
 * The worker will auto-refresh the access token before it expires.
 */
async function seedTokens(): Promise<void> {
  if (!ACCESS_TOKEN) {
    console.error('  Error: SLACK_ACCESS_TOKEN is required for --seed-tokens');
    process.exit(1);
  }
  if (!ADMIN_USER || !ADMIN_PASS) {
    console.error('  Error: ADMIN_USER and ADMIN_PASSWORD are required for --seed-tokens');
    process.exit(1);
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Seeding OAuth2 tokens into KV');
  console.log('════════════════════════════════════════════════════════');

  const res = await fetch(`${BASE_URL}/auth/tokens/${PIECE}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Basic auth with admin credentials
      authorization: `Basic ${btoa(`${ADMIN_USER}:${ADMIN_PASS}`)}`,
    },
    body: JSON.stringify({
      userId: USER_ID_SLACK,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN || undefined,
      expiresIn: EXPIRES_IN,
    }),
  });

  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Seed failed: ${data.error ?? res.status}`);

  console.log(`  Stored tokens for userId=${USER_ID_SLACK} in KV`);
  if (REFRESH_TOKEN) console.log('  Refresh token stored — worker will auto-refresh on expiry.');
  else console.log('  No refresh token — re-run --seed-tokens when access token expires.');
  console.log(`\n  Next: run actions/triggers with SLACK_USER_ID=${USER_ID_SLACK} (no SLACK_BOT_TOKEN needed)\n`);
}

// ─── Exploration ──────────────────────────────────────────────────────────────

async function listPiece(): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Slack piece — actions & triggers');
  console.log('════════════════════════════════════════════════════════');

  const pieces = await get('/pieces') as Array<{
    name: string;
    displayName: string;
    actions: Array<{ name: string; displayName: string }>;
    triggers: Array<{ name: string; displayName: string; type: string }>;
  }>;

  const slack = pieces.find((p) => p.name === PIECE);
  if (!slack) { console.log('  Slack piece not registered.'); return; }

  const triggers = slack.triggers ?? [];
  console.log(`\n  ${slack.displayName} — ${slack.actions.length} actions, ${triggers.length} triggers\n`);

  console.log('  Actions:');
  for (const a of slack.actions) console.log(`    • ${a.name.padEnd(50)} ${a.displayName}`);

  console.log('\n  Triggers:');
  for (const t of triggers) console.log(`    • ${t.name.padEnd(50)} ${t.displayName}  [${t.type}]`);
  if (triggers.length === 0) console.log('    (none returned — worker may need redeploying: fp deploy -y)');
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function demoActions(): Promise<void> {
  if (!BOT_TOKEN && USER_ID_SLACK === 'U0000000000') {
    console.log('\n  [skip] No SLACK_BOT_TOKEN or SLACK_USER_ID set — actions require a token.');
    return;
  }

  // ── 1. Send channel message ────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Action: send_channel_message');
  console.log('════════════════════════════════════════════════════════');

  const sendResult = await run('send_channel_message', {
    channel: CHANNEL,
    text: 'Hello from freepieces! 👋',
    sendAsBot: true,
    // Optional: username, profilePicture, blocks, ...
  }) as { ts?: string; channel?: string } | undefined;

  console.log('  Message sent:', JSON.stringify(sendResult, null, 2));
  const messageTs = sendResult?.ts ?? '';

  // ── 2. Add a reaction ─────────────────────────────────────────────────────
  if (messageTs) {
    console.log('\n════════════════════════════════════════════════════════');
    console.log(' Action: slack-add-reaction-to-message');
    console.log('════════════════════════════════════════════════════════');

    const reactionResult = await run('slack-add-reaction-to-message', {
      channel: CHANNEL,
      reaction: 'rocket',
      ts: messageTs,
    });

    console.log('  Reaction added:', JSON.stringify(reactionResult, null, 2));
  }

  // ── 3. Send DM ────────────────────────────────────────────────────────────
  if (USER_ID_SLACK !== 'U0000000000') {
    console.log('\n════════════════════════════════════════════════════════');
    console.log(' Action: send_direct_message');
    console.log('════════════════════════════════════════════════════════');

    const dmResult = await run('send_direct_message', {
      userId: USER_ID_SLACK,
      text: 'Direct message from freepieces!',
    });

    console.log('  DM sent:', JSON.stringify(dmResult, null, 2));
  }
}

// ─── Triggers ─────────────────────────────────────────────────────────────────

async function demoTriggers(): Promise<void> {
  // ── new-message ────────────────────────────────────────────────────────────
  // This is the exact JSON body Slack sends to your Events API endpoint when
  // a user posts a public channel message.
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Trigger: new-message (channel message matches)');
  console.log('════════════════════════════════════════════════════════');

  const channelMessagePayload = {
    type: 'event_callback',
    event_id: 'Ev01234',
    event_time: Math.floor(Date.now() / 1000),
    event: {
      type: 'message',
      channel: CHANNEL,
      channel_type: 'channel',         // 'channel' | 'group' for public/private
      user: USER_ID_SLACK,
      text: 'Hello everyone!',
      ts: '1234567890.000100',
    },
    authorizations: [{ enterprise_id: null, team_id: 'T0001', user_id: 'UBOT', is_bot: true }],
  };

  const newMessageEvents = await trigger('new-message', channelMessagePayload, {
    // No channel filter = match all channels
  });
  console.log(`  Matched events (${newMessageEvents.length}):`, JSON.stringify(newMessageEvents, null, 2));

  // ── new-message-in-channel filtered to a specific channel ──────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Trigger: new-message-in-channel (wrong channel — should return [])');
  console.log('════════════════════════════════════════════════════════');

  const wrongChannelPayload = {
    ...channelMessagePayload,
    event: { ...channelMessagePayload.event, channel: 'C_OTHER_CHANNEL' },
  };

  const emptyEvents = await trigger('new-message-in-channel', wrongChannelPayload, {
    channel: CHANNEL, // filter: only match CHANNEL
  });
  console.log(`  Matched events (${emptyEvents.length}):`, emptyEvents);

  // ── new-mention ────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Trigger: new_mention (@-mention)');
  console.log('════════════════════════════════════════════════════════');

  const mentionPayload = {
    type: 'event_callback',
    event: {
      type: 'app_mention',
      channel: CHANNEL,
      user: USER_ID_SLACK,
      text: '<@UBOT> hey bot, summarise this channel',
      ts: '1234567890.000200',
    },
  };

  const mentionEvents = await trigger('new_mention', mentionPayload);
  console.log(`  Matched events (${mentionEvents.length}):`, JSON.stringify(mentionEvents, null, 2));

  // ── new-reaction-added ─────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Trigger: new_reaction_added (:rocket: on any message)');
  console.log('════════════════════════════════════════════════════════');

  const reactionPayload = {
    type: 'event_callback',
    event: {
      type: 'reaction_added',
      user: USER_ID_SLACK,
      reaction: 'rocket',
      item_user: 'U_AUTHOR',
      item: { type: 'message', channel: CHANNEL, ts: '1234567890.000100' },
      event_ts: '1234567890.000300',
    },
  };

  const reactionEvents = await trigger('new_reaction_added', reactionPayload, {
    emojis: ['rocket'],  // filter: only rocket reactions
  });
  console.log(`  Matched events (${reactionEvents.length}):`, JSON.stringify(reactionEvents, null, 2));
}

// ─── Webhook subscriptions (server-side: no local process needed) ───────────

const CALLBACK_URL = process.env['SLACK_CALLBACK_URL'] ?? '';

/**
 * Register a persistent subscription on the deployed worker.
 * Slack posts all events to POST /webhook/slack and the worker fans them out
 * to each subscription's callbackUrl — no local process required.
 *
 * Prerequisites:
 *   1. Set Slack app → Event Subscriptions → Request URL to:
        https://<your-worker>.workers.dev/webhook/slack
 *   2. Subscribe to bot events: message.channels, app_mention, reaction_added
 *   3. Set SLACK_CALLBACK_URL in .env to the HTTPS URL that receives matched events.
 */
async function subscribe(triggerName: string, propsValue: Record<string, unknown> = {}): Promise<void> {
  if (!CALLBACK_URL) {
    console.error('  Error: SLACK_CALLBACK_URL is required — set it to your HTTPS callback URL');
    process.exit(1);
  }

  console.log(`\n  Subscribing to trigger: ${triggerName}`);
  const res = await fetch(`${BASE_URL}/subscriptions/${PIECE}/${triggerName}`, {
    method: 'POST',
    headers: buildRuntimeHeaders(),
    body: JSON.stringify({ callbackUrl: CALLBACK_URL, propsValue }),
  });
  const data = await res.json() as { ok: boolean; id?: string; webhookUrl?: string; error?: string };
  if (!data.ok) throw new Error(`Subscribe failed: ${data.error ?? res.status}`);

  console.log(`  ✓ Subscription created: ${data.id}`);
  console.log(`  Webhook URL: ${data.webhookUrl}`);
  console.log(`  Callback URL: ${CALLBACK_URL}`);
  console.log(`\n  → Point Slack Event Subscriptions → Request URL to: ${data.webhookUrl}`);
  console.log('  → Subscribe to bot events: message.channels, app_mention, reaction_added');
}

/** List all active subscriptions for the Slack piece. */
async function listSubs(): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Active webhook subscriptions');
  console.log('════════════════════════════════════════════════════════');

  const res = await fetch(`${BASE_URL}/subscriptions/${PIECE}`, {
    headers: buildRuntimeHeaders(false),
  });
  const data = await res.json() as { ok: boolean; subscriptions?: Array<{ id: string; trigger: string; propsValue: Record<string, unknown>; callbackUrl: string; createdAt: string }>; error?: string };
  if (!data.ok) throw new Error(`List failed: ${data.error ?? res.status}`);

  const subs = data.subscriptions ?? [];
  if (subs.length === 0) {
    console.log('  (no subscriptions)');
    return;
  }
  for (const s of subs) {
    console.log(`\n  id:          ${s.id}`);
    console.log(`  trigger:     ${s.trigger}`);
    console.log(`  callbackUrl: ${s.callbackUrl}`);
    console.log(`  propsValue:  ${JSON.stringify(s.propsValue)}`);
    console.log(`  createdAt:   ${s.createdAt}`);
  }
}

/** Delete a subscription by id. */
async function unsubscribe(id: string, triggerName: string): Promise<void> {
  console.log(`\n  Deleting subscription: ${id}`);
  const res = await fetch(`${BASE_URL}/subscriptions/${PIECE}/${triggerName}/${id}`, {
    method: 'DELETE',
    headers: buildRuntimeHeaders(false),
  });
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Unsubscribe failed: ${data.error ?? res.status}`);
  console.log(`  ✓ Subscription deleted: ${id}`);
}

// ─── Real-event listener ─────────────────────────────────────────────────────

/**
 * Start a local HTTP server that receives real Slack Events API webhooks,
 * forwards each incoming payload to every relevant freepieces trigger endpoint,
 * and prints the matched events.
 *
 * Slack requires a publicly reachable URL.  Expose this server with:
 *   cloudflared tunnel --url http://localhost:<port>
 *   # or: ngrok http <port>
 * Then set the resulting URL + "/slack/events" as your Slack app's
 * Events API → Request URL.
 */
async function listenForEvents(port: number): Promise<void> {
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Listening for real Slack events');
  console.log('════════════════════════════════════════════════════════');
  console.log(`\n  Local endpoint: http://localhost:${port}/slack/events`);
  console.log('  Expose publicly, then set as your Slack app Events API → Request URL.');
  console.log('    cloudflared tunnel --url http://localhost:' + port);
  console.log('    ngrok http ' + port);
  console.log('\n  Waiting for events... (Ctrl+C to stop)\n');

  // Triggers to fan-out to — all that fire on normal message/mention/reaction events.
  const TRIGGERS = ['new-message', 'new-message-in-channel', 'new_mention', 'new_reaction_added'];

  Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const { pathname } = new URL(req.url);
      if (pathname !== '/slack/events') return new Response('Not found', { status: 404 });
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return new Response('Bad JSON', { status: 400 });
      }

      // Slack URL verification handshake (one-time, when you save the Request URL)
      if (body['type'] === 'url_verification') {
        console.log('  ✓ Slack URL verification passed — endpoint is live.');
        return Response.json({ challenge: body['challenge'] });
      }

      const eventType = (body['event'] as Record<string, unknown> | undefined)?.['type'];
      console.log(`\n  ← Event received: ${String(eventType ?? 'unknown')}`);

      let anyMatch = false;
      for (const triggerName of TRIGGERS) {
        try {
          const events = await trigger(triggerName, body);
          if (events.length > 0) {
            console.log(`  ✓  [${triggerName}] matched ${events.length} event(s):`);
            console.log(JSON.stringify(events, null, 2));
            anyMatch = true;
          }
        } catch {
          // This trigger doesn't handle this event type — skip silently.
        }
      }
      if (!anyMatch) console.log('  —  No triggers matched this event.');

      // Slack requires a 200 within 3 s or it will retry.
      return new Response('OK', { status: 200 });
    },
  });

  // Keep the process alive until Ctrl+C.
  await new Promise<never>(() => {});
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const actionsOnly   = args.includes('--actions');
  const triggersOnly  = args.includes('--triggers');
  const seedMode      = args.includes('--seed-tokens');
  const listenMode    = args.includes('--listen');
  const subscribeMode = args.includes('--subscribe');
  const unsubMode     = args.includes('--unsubscribe');
  const listSubsMode  = args.includes('--list-subs');
  const helpMode      = args.includes('--help') || args.includes('-h');

  if (helpMode) {
    console.log([
      '',
      'Usage: npx tsx examples/slack-example.ts [options]',
      '',
      'Options:',
      '  (none)                    Run all demos (actions + triggers)',
      '  --actions                 Run action demos only',
      '  --triggers                Run trigger demos only',
      '  --seed-tokens             Store OAuth2 access+refresh tokens in KV (one-time setup)',
      '',
      'Webhook subscriptions (Slack Events API → deployed worker → your callback URL):',
      '  --subscribe               Register a subscription on the deployed worker',
      '    --trigger=<name>        Trigger to subscribe to (default: new-message)',
      '    SLACK_CALLBACK_URL=...  HTTPS URL to receive matched events',
      '  --list-subs               List active subscriptions',
      '  --unsubscribe             Delete a subscription',
      '    --sub-id=<uuid>         Subscription ID to delete',
      '    --trigger=<name>        Trigger name (required for delete route)',
      '',
      'Local listener (no deployment needed; requires cloudflared/ngrok for public URL):',
      '  --listen                  Start a local server and wait for real Slack events',
      '  --port=<n>                Port for --listen (default: 3000)',
      '',
      '  -h, --help                Show this help',
      '',
      'Auth modes (set in .env):',
      '  Bot token:       SLACK_BOT_TOKEN=xoxb-...',
      '  OAuth2 rotation: SLACK_ACCESS_TOKEN + SLACK_REFRESH_TOKEN (run --seed-tokens first)',
      '',
      'Webhook setup (one-time):',
      '  1. wrangler secret put SLACK_SIGNING_SECRET   (from Slack app → Basic Information)',
      `  2. Slack app → Event Subscriptions → Request URL: ${BASE_URL}/webhook/slack`,
      '  3. Subscribe to bot events: message.channels, app_mention, reaction_added',
      `  4. SLACK_CALLBACK_URL=https://... npx tsx examples/slack-example.ts --subscribe --trigger=new-message`,
      '',
    ].join('\n'));
    return;
  }

  if (seedMode) {
    await seedTokens();
    return;
  }

  if (subscribeMode) {
    const triggerArg = args.find((a) => a.startsWith('--trigger='));
    const triggerName = triggerArg ? triggerArg.slice('--trigger='.length) : 'new-message';
    await subscribe(triggerName);
    return;
  }

  if (listSubsMode) {
    await listSubs();
    return;
  }

  if (unsubMode) {
    const subIdArg = args.find((a) => a.startsWith('--sub-id='));
    const triggerArg = args.find((a) => a.startsWith('--trigger='));
    const subId = subIdArg ? subIdArg.slice('--sub-id='.length) : '';
    const triggerName = triggerArg ? triggerArg.slice('--trigger='.length) : 'new-message';
    if (!subId) {
      console.error('  Error: --sub-id=<uuid> is required for --unsubscribe');
      process.exit(1);
    }
    await unsubscribe(subId, triggerName);
    return;
  }

  if (listenMode) {
    const portArg = args.find((a) => a.startsWith('--port='));
    const port = portArg ? parseInt(portArg.slice('--port='.length), 10) : 3000;
    await listenForEvents(port);
    return;
  }

  // ── Health check ─────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Checking /health');
  console.log('════════════════════════════════════════════════════════');
  const health = await get('/health') as { ok: boolean };
  console.log('  Worker status:', health.ok ? 'OK ✓' : 'not OK');

  await listPiece();

  if (!triggersOnly) await demoActions();
  if (!actionsOnly)  await demoTriggers();

  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  process.exit(1);
});
