# Polling triggers in freepieces

This document explains how polling triggers work in freepieces, using Gmail as the main example.

In short:

- A polling trigger does not wait for the provider to push an event.
- Your scheduler calls `POST /trigger/:piece/:trigger` on an interval.
- The worker runs the trigger code and returns matching events.
- Your scheduler stores the polling state and passes it back on the next run.

If you are looking for webhook fan-out, that is a different path. Webhook subscriptions use `/subscriptions/...` and `/webhook/...`. They do not schedule polling jobs for you.

## What a polling trigger is

A polling trigger is a function that asks an external API for new data since the last successful check.

In the codebase, native polling triggers use this shape:

```ts
interface PieceTriggerContext {
  auth?: Record<string, string>;
  props?: Record<string, unknown>;
  lastPollMs?: number;
  env: Env;
}

interface PieceTrigger {
  type: 'POLLING';
  run(ctx: PieceTriggerContext): Promise<unknown[]>;
}
```

The important field is `lastPollMs`:

- It is the Unix timestamp, in milliseconds, of the last successful poll.
- The caller must persist it.
- The worker does not store it for you.

For Gmail, the polling trigger reads `lastPollMs`, converts it to seconds, adds Gmail's `after:<timestamp>` search operator, and returns only newer matching emails.

## The big mental model

There are three moving parts:

1. **Authentication**
   - Gmail OAuth tokens are stored in `TOKEN_STORE` under a `userId`.
   - The poll request identifies which stored token to use.

2. **Scheduling**
   - freepieces does not run a built-in polling scheduler.
   - You provide the schedule with a cron job, another worker, GitHub Actions, a queue consumer, or any external scheduler.

3. **State**
   - Your scheduler stores the last successful polling state.
   - On the next run, it sends that state back in the request body.

If one of those parts is missing, the trigger will not behave like a continuous event stream. It will just be a one-off query.

## Polling is not the same as subscriptions

These two features solve different problems.

| Topic | Polling trigger | Webhook subscription |
| --- | --- | --- |
| Entry point | `POST /trigger/:piece/:trigger` | `POST /subscriptions/:piece/:trigger` and `POST /webhook/:piece` |
| Who starts the work | Your scheduler | The external service sends a webhook |
| State storage | You store `lastPollMs` or other watermark state | freepieces stores subscription records in KV |
| Delivery model | Response contains `events` | Worker posts matched events to a callback URL or Cloudflare Queue |
| Native Gmail support | Yes | No |
| AP webhook pieces | Sometimes, depending on trigger type | Yes, this is the main use case |

Important detail: the subscription routes currently accept only AP pieces. Gmail in this repository is a native piece, so Gmail polling goes through `/trigger/gmail/...`, not `/subscriptions/gmail/...`.

## Runtime request contract

For polling a trigger, call:

```text
POST /trigger/:piece/:trigger
```

### Headers when `RUN_API_KEY` is configured

Use the split auth contract:

```http
Authorization: Bearer <RUN_API_KEY>
X-User-Id: <userId>
```

For Gmail, `X-User-Id` is the key used to look up the stored OAuth token in KV.

### Headers in local dev when `RUN_API_KEY` is not configured

In local development, the bearer token can act as the fallback identity:

```http
Authorization: Bearer <userId>
```

For Gmail, that bearer value acts as the lookup key for the stored token. The fallback exists to make local testing easier, but deployed setups should use `RUN_API_KEY` plus `X-User-Id`.

### Request body for native polling triggers

```json
{
  "propsValue": {
    "from": "alerts@example.com",
    "subject": "invoice"
  },
  "lastPollMs": 1713206400000
}
```

Fields:

- `propsValue`: trigger filter inputs
- `lastPollMs`: the last successful poll watermark in milliseconds
- `payload`: optional for the generic endpoint, but ignored by native Gmail polling triggers

### Response shape

```json
{
  "ok": true,
  "events": [
    {
      "message": {
        "id": "...",
        "threadId": "...",
        "from": "alerts@example.com",
        "subject": "invoice ready"
      },
      "thread": {
        "id": "..."
      }
    }
  ]
}
```

If no new items match, `events` is an empty array.

## Gmail example: `gmail_new_email_received`

The Gmail "New Email" trigger is defined as a native `POLLING` trigger.

Behavior in plain English:

1. Read the OAuth access token from `ctx.auth.accessToken`.
2. Read filter props such as `from`, `to`, `subject`, `label`, and `category`.
3. Read `ctx.lastPollMs`.
4. Convert `lastPollMs` to seconds for Gmail's `after:` query operator.
5. Call `GET /users/me/messages` with the assembled Gmail search query.
6. Fetch the full message and thread for each hit.
7. Drop any message whose `internalDate` is not newer than `lastPollMs`.
8. Return the remaining events as `{ message, thread }` objects.

The current implementation also has two built-in limits:

- On the first run, when `lastPollMs` is `0` or missing, it fetches up to **5** recent messages.
- On later runs, it fetches up to **20** messages per poll.

That first-run behavior is a seed or backfill. It is intentional.

## Gmail filters used by the trigger

The trigger builds a Gmail search query from the supplied props.

Supported filter props in the current implementation:

- `from`
- `to`
- `subject`
- `label`
- `category`

Example query the trigger may build:

```text
from:(alerts@example.com) subject:(invoice) after:1713206400
```

If `lastPollMs` is `0`, the `after:` clause is omitted.

## End-to-end Gmail polling flow

### 1. Connect Gmail once

First, connect a Gmail account and store its OAuth token in KV:

```text
GET /auth/login/gmail?userId=<your-user-id>
```

After the OAuth callback completes, freepieces stores the token under that `userId`.

### 2. Choose a scheduler

Pick anything that can make HTTP requests on a schedule:

- Cloudflare Cron Trigger in another worker
- GitHub Actions
- a VPS cron job
- a queue consumer
- a CI job
- a serverless scheduled function

freepieces itself does not create this scheduler.

### 3. Store polling state outside the worker

Store at least:

- `userId`
- `lastPollMs`
- any trigger props you want to keep fixed

You can store the state in KV, D1, SQLite, Redis, Postgres, or even a JSON file for local experiments.

### 4. Poll Gmail on your interval

Example request for a deployed worker:

```bash
curl -X POST "https://<your-worker>.workers.dev/trigger/gmail/gmail_new_email_received" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "X-User-Id: $GMAIL_USER_ID" \
  -d '{
    "propsValue": {
      "from": "alerts@example.com",
      "subject": "invoice"
    },
    "lastPollMs": 1713206400000
  }'
```

### 5. Process the events

The worker returns matching events in the response body. Your scheduler decides what to do next:

- enqueue jobs
- write to a database
- call another API
- send Slack messages
- trigger another workflow

### 6. Advance the watermark only after success

This part matters.

Do not update `lastPollMs` before downstream processing succeeds.

A safe pattern is:

1. Capture `pollStartedAt = Date.now()` immediately before calling `/trigger/...`.
2. Run the trigger request.
3. Process the returned events.
4. If everything succeeds, save `lastPollMs = pollStartedAt`.

Why use `pollStartedAt` instead of `Date.now()` after processing?

Because emails can arrive while you are polling and processing. If you save a later timestamp, you can skip messages that arrived in that gap. Using the poll start time avoids that hole.

## Recommended scheduler logic

Here is a simple TypeScript example for Gmail polling:

```ts
const state = await loadState();
const pollStartedAt = Date.now();

const response = await fetch(
  `${BASE_URL}/trigger/gmail/gmail_new_email_received`,
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${RUN_API_KEY}`,
      'x-user-id': state.userId,
    },
    body: JSON.stringify({
      propsValue: state.propsValue,
      lastPollMs: state.lastPollMs ?? 0,
    }),
  },
);

const body = await response.json() as {
  ok: boolean;
  events?: Array<{
    message: { id: string; threadId: string; subject?: string };
    thread: unknown;
  }>;
  error?: string;
};

if (!body.ok) {
  throw new Error(body.error ?? 'Polling failed');
}

for (const event of body.events ?? []) {
  await handleEmail(event);
}

await saveState({
  ...state,
  lastPollMs: pollStartedAt,
});
```

For production code, also make downstream handling idempotent. Using `message.id` as a dedupe key is a good start.

## First-run and backfill behavior

When `lastPollMs` is missing or `0`, Gmail polling treats the request as a seed run.

For `gmail_new_email_received`, that means:

- no `after:` filter is sent
- up to 5 recent messages are returned

This is useful for:

- testing the integration
- seeding a small initial batch
- verifying that auth and filters work

If you want a completely empty first run, your scheduler must decide how to seed `lastPollMs` itself.

For example, you can initialize `lastPollMs = Date.now()` and store it before the first poll.

## Gmail polling state by trigger

Not every Gmail trigger uses only `lastPollMs`.

| Trigger | State you should persist | Notes |
| --- | --- | --- |
| `gmail_new_email_received` | `lastPollMs` | Uses Gmail search with `after:` |
| `new_attachment` | `lastPollMs` | Same pattern, plus `has:attachment` |
| `new_labeled_email` | `propsValue.lastHistoryId` | Uses Gmail History API |
| `new_conversation` | `propsValue.lastHistoryId` and sometimes `processedThreadIds` | Uses Gmail History API plus thread checks |
| `new_label` | `propsValue.knownLabelIds` | Returns labels not seen before |

So the general rule is:

- `lastPollMs` is the common watermark for time-based polling.
- Some Gmail triggers need extra state in `propsValue`.
- freepieces returns events, but it does not mutate and persist your polling state.

For the History API-based Gmail triggers, plan on trigger-specific state management in your scheduler. The worker runs the trigger logic, but it does not automatically hand you back a ready-to-store next watermark.

## Common mistakes

### Expecting the worker to schedule the job

It does not. The worker executes polling only when you call `/trigger/...`.

### Expecting `/subscriptions/...` to work for Gmail polling

It will not. Subscriptions are for AP webhook-style flows, not native Gmail polling.

### Updating `lastPollMs` too early

If you advance the watermark before event processing completes, you can lose events.

### Updating `lastPollMs` too late

If you save a timestamp from after the whole job finishes, you can skip messages that arrived during the poll window.

### Forgetting `X-User-Id` when `RUN_API_KEY` is enabled

With deployed auth enabled, `Authorization` identifies the caller. `X-User-Id` identifies which Gmail token to use.

### Assuming `payload` matters for Gmail polling

It does not. `payload` is part of the generic trigger endpoint, but native Gmail polling reads `propsValue` and `lastPollMs`.

## Troubleshooting

### The trigger returns `No access token available`

The Gmail token could not be resolved.

Check:

- Did you finish the OAuth flow with `/auth/login/gmail?userId=...`?
- Are you sending the same `X-User-Id` value you used during OAuth?
- Is `TOKEN_STORE` configured correctly?

### The trigger always returns an empty array

Check:

- whether your Gmail search filters are too narrow
- whether `lastPollMs` is already ahead of the messages you expect
- whether you are polling the correct Gmail account

Try a seed run with `lastPollMs: 0` to verify the trigger and auth first.

### The first run returns old messages

That is expected. The first run is a backfill of up to 5 recent items.

### I want push delivery for Gmail

This repository's Gmail piece is implemented as native polling. If you need push-style behavior, you need an external component that polls and then forwards events into your own queue, webhook, or workflow system.

## Quick reference

### Native polling checklist

- Connect OAuth and store the token
- Choose a scheduler outside freepieces
- Persist `lastPollMs` outside the worker
- Call `POST /trigger/gmail/gmail_new_email_received`
- Process `events`
- Save the new watermark only after success

### Request summary

```json
{
  "propsValue": {
    "from": "alerts@example.com"
  },
  "lastPollMs": 1713206400000
}
```

### Header summary for deployed workers

```http
Authorization: Bearer <RUN_API_KEY>
X-User-Id: <your-user-id>
Content-Type: application/json
```

## Source files

If you want to trace the behavior in code, start here:

- `src/framework/types.ts` — polling trigger context and types
- `src/worker.ts` — `/trigger/:piece/:trigger` route and runtime auth
- `src/pieces/gmail.ts` — Gmail polling trigger implementations
- `README.md` — runtime auth contract and route overview
