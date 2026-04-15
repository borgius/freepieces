/**
 * Gmail piece — end-to-end example
 *
 * This script walks through the full freepieces OAuth2 flow for Gmail:
 *   1. Print the login URL  (you open it in a browser once to authorize)
 *   2. Use the stored token to send an email
 *   3. Search for that email
 *   4. Fetch and display it by ID
 *
 * Prerequisites
 * ─────────────
 *   • Worker deployed:       ./deploy.sh
 *   • Gmail secrets set:     wrangler secret put GMAIL_CLIENT_ID
 *                            wrangler secret put GMAIL_CLIENT_SECRET
 *   • Node.js ≥ 20 with tsx: npx tsx examples/gmail-example.ts
 *
 * Usage (first time — authorize your Google account)
 * ─────────────────────────────────────────────────
 *   npx tsx examples/gmail-example.ts --authorize
 *
 *   Open the printed URL in your browser, approve access, and wait for the
 *   callback page to confirm success.  The token is stored in KV under your
 *   USER_ID and never needs to be re-authorized unless you revoke it.
 *
 * Usage (send + search + get)
 * ──────────────────────────
 *   npx tsx examples/gmail-example.ts
 *
 * Environment variables (all optional — fall back to the defaults below)
 * ──────────────────────────────────────────────────────────────────────
 *   FREEPIECES_URL   base URL of the deployed worker
 *   USER_ID          any stable identifier for the Gmail account owner
 *   RECIPIENT_EMAIL  where to send the test email (defaults to your own address)
 */

const BASE_URL = process.env['FREEPIECES_URL'] ?? 'http://localhost:8787';
const USER_ID = process.env['USER_ID'] ?? 'your-user-id';
const RECIPIENT_EMAIL = process.env['RECIPIENT_EMAIL'] ?? 'your@email.com';

// When RUN_API_KEY is set the Authorization header carries the shared secret and
// the userId is sent separately as X-User-Id.  When absent (local dev) the
// bearer token IS the userId (backward-compatible).
const RUN_API_KEY = process.env['RUN_API_KEY'];

const PIECE = 'gmail';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Call a piece action.
 * In secured mode the shared RUN_API_KEY authenticates the caller and USER_ID
 * is sent separately as X-User-Id for OAuth2 KV lookup.
 * In local dev (no RUN_API_KEY) USER_ID remains the bearer fallback.
 */
async function run(action: string, props: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${RUN_API_KEY ?? USER_ID}`,
  };
  if (RUN_API_KEY) {
    headers['x-user-id'] = USER_ID;
  }
  const res = await fetch(`${BASE_URL}/run/${PIECE}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(props),
  });
  const json = await res.json() as { ok: boolean; result?: unknown; error?: string };
  if (!json.ok) throw new Error(`Action ${action} failed: ${json.error ?? 'unknown error'}`);
  return json.result;
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function printLoginUrl(): void {
  const loginUrl = `${BASE_URL}/auth/login/${PIECE}?userId=${encodeURIComponent(USER_ID)}`;
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' STEP 1 — Authorize Gmail access');
  console.log('════════════════════════════════════════════════════════');
  console.log('\nOpen this URL in your browser:\n');
  console.log(' ', loginUrl);
  console.log('\nAfter approving, Google redirects you to the worker callback.');
  console.log('You should see: {"ok":true,"piece":"gmail","userId":"..."}');
  console.log('\nOnce that succeeds, run the script again without --authorize.\n');
}

async function runDemo(): Promise<void> {
  // ── 1. Verify the worker is up ────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Checking /health');
  console.log('════════════════════════════════════════════════════════');
  const health = await get('/health') as { ok: boolean; timestamp?: string };
  console.log('Worker status:', health.ok ? 'OK ✓' : 'not OK');

  // ── 2. List registered pieces ─────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' Registered pieces');
  console.log('════════════════════════════════════════════════════════');
  const pieces = await get('/pieces') as Array<{ name: string; displayName: string; actions: Array<{ name: string }> }>;
  for (const p of pieces) {
    console.log(`  • ${p.displayName} (${p.name})  — ${p.actions.length} action(s)`);
  }

  // ── 3. Send a test email ─────────────────────────────────────────────────
  const subject = `Freepieces Gmail test — ${new Date().toISOString()}`;
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' send_email');
  console.log('════════════════════════════════════════════════════════');
  console.log(`Sending to: ${RECIPIENT_EMAIL}`);
  console.log(`Subject   : ${subject}`);

  const sendResult = await run('send_email', {
    receiver: [RECIPIENT_EMAIL],
    subject,
    body: `<h2>Hello from freepieces!</h2>
<p>This email was sent using the <code>gmail</code> piece running on a Cloudflare Worker.</p>
<p>Sent at: <strong>${new Date().toLocaleString()}</strong></p>`,
    body_type: 'html',
  }) as { id?: string; threadId?: string };

  console.log('Sent!  Message ID:', sendResult.id ?? '(no id in response)');
  const msgId = sendResult.id;

  // ── 4. Search for the email ───────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' gmail_search_mail');
  console.log('════════════════════════════════════════════════════════');
  console.log(`Searching for subject: "${subject.slice(0, 30)}…"`);

  // Brief pause — Gmail indexing can take a second
  await new Promise((r) => setTimeout(r, 3000));

  const searchResult = await run('gmail_search_mail', {
    subject: 'Freepieces Gmail test',
    max_results: 3,
  }) as { found: boolean; results: { messages: Array<{ id: string; subject?: string; from?: string }> } };

  if (searchResult.found) {
    console.log(`Found ${searchResult.results.messages.length} message(s):`);
    for (const m of searchResult.results.messages) {
      console.log(`  id: ${m.id}  subject: ${m.subject ?? '(none)'}  from: ${m.from ?? '(none)'}`);
    }
  } else {
    console.log('No messages found yet (try again in a few seconds if freshly sent).');
  }

  // ── 5. Get email by ID ────────────────────────────────────────────────────
  if (msgId) {
    console.log('\n════════════════════════════════════════════════════════');
    console.log(' gmail_get_mail');
    console.log('════════════════════════════════════════════════════════');
    console.log(`Fetching message ID: ${msgId}`);

    const getResult = await run('gmail_get_mail', { message_id: msgId }) as {
      id: string;
      from?: string;
      to?: string;
      subject?: string;
      snippet?: string;
      body_text?: string;
    };

    console.log('  from   :', getResult.from);
    console.log('  to     :', getResult.to);
    console.log('  subject:', getResult.subject);
    console.log('  snippet:', getResult.snippet);
  }

  console.log('\n✓ Done.\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--authorize')) {
  printLoginUrl();
} else {
  runDemo().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n✘ Error:', msg);
    if (msg.includes('No access token')) {
      console.error('\nHint: You need to authorize first. Run:');
      console.error('  npx tsx examples/gmail-example.ts --authorize\n');
    }
    process.exit(1);
  });
}
