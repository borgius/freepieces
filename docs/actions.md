# Actions in freepieces

This document explains how actions work in freepieces.

Use an action when you want the worker to **do something now** and return the result in the HTTP response.

Examples:

- send an email with Gmail
- post a Slack message
- fetch a record from an API
- call a custom API endpoint
- run a simple API-key-backed operation such as `ping`

If you want event-driven behavior, read [`docs/triggers.md`](./triggers.md). If you want time-based polling, read [`docs/pooling.md`](./pooling.md).

## The short version

Actions use one main runtime route:

```text
POST /run/:piece/:action
```

The caller sends:

- runtime auth headers
- a JSON body containing the action props

The worker then:

1. resolves the piece and action
2. resolves auth for that piece
3. runs the action
4. returns `{ ok: true, result }`

Actions are synchronous from the caller's point of view. They do not create subscriptions, wait for external events, or push results to queues.

## What an action is

An action is a named operation on a piece.

In the native freepieces model, an action looks like this:

```ts
interface PieceActionContext {
  auth?: Record<string, string>;
  props?: Record<string, unknown>;
  env: Env;
}

interface PieceAction {
  name: string;
  displayName: string;
  description?: string;
  props?: Record<string, PropDefinition>;
  run(ctx: PieceActionContext): Promise<unknown>;
}
```

Important points:

- `name` is the runtime identifier used in the URL
- `displayName` is for humans
- `props` are the user inputs
- `auth` contains resolved credentials for the piece
- `env` contains the worker bindings and secrets

## One route, two implementation styles

The nice part of `freepieces` is that callers use the same `/run/:piece/:action` contract for both:

- **native freepieces pieces**, and
- **AP community pieces** registered through the compatibility layer

The worker hides the differences.

### Native piece actions

For native pieces, the worker calls:

```ts
action.run({ auth, props, env })
```

### AP community actions

For AP pieces, the worker builds the context expected by `@activepieces/pieces-framework` and then calls:

```ts
action.run(apContext)
```

That AP context includes:

- `auth`
- `propsValue`
- worker metadata shims
- placeholder helpers such as `files`, `store`, and `server`

The HTTP contract is the same either way.

## Discovering pieces and action names

Before calling an action, you need the runtime piece name and action name.

Use:

```text
GET /pieces
```

That returns the registered pieces and their action names.

Example workflow:

1. call `GET /pieces`
2. find the piece, such as `gmail` or `slack`
3. pick the action name, such as `send_email` or `send_channel_message`
4. call `POST /run/:piece/:action`

Use the action `name`, not the `displayName`.

Good:

```text
POST /run/gmail/send_email
```

Not good:

```text
POST /run/Gmail/Send Email
```

## Runtime auth contract

Actions use the same runtime auth contract as the other runtime endpoints.

### When `RUN_API_KEY` is configured

Use the split auth contract:

```http
Authorization: Bearer <RUN_API_KEY>
X-User-Id: <userId>
X-Piece-Token: <token>
```

Meaning:

- `Authorization` authenticates the caller
- `X-User-Id` selects a stored OAuth2 token from KV
- `X-Piece-Token` passes a direct runtime credential such as a bot token or raw API key

Send the headers that match the piece auth model.

### Local dev when `RUN_API_KEY` is not configured

In local development, the bearer token becomes the fallback for both identity styles:

```http
Authorization: Bearer <userId-or-pieceToken>
```

You can still send `X-User-Id` and `X-Piece-Token` explicitly. The examples and SDK do that when possible so local and deployed behavior stay aligned.

## Auth by piece type

This is the part that usually trips people up, so here is the concrete version.

### OAuth2 pieces, such as Gmail

For OAuth2-backed actions:

- first connect the account with `GET /auth/login/:piece?userId=<id>`
- the OAuth token is stored in `TOKEN_STORE`
- later action calls send `X-User-Id: <id>`
- the worker loads the stored token from KV
- if a refresh token exists, the worker refreshes the access token automatically when needed

For Gmail, this is the common pattern.

### Direct credential pieces, such as Slack bot-token auth or native API-key pieces

For direct credential actions:

- send the credential as `X-Piece-Token` when `RUN_API_KEY` is enabled
- in local dev, the same value may be used as the bearer fallback

Examples:

- Slack bot token: `xoxb-...`
- raw API key
- direct access token for a provider that does not use stored OAuth tokens

### No-auth pieces

No-auth pieces simply run without auth material.

## Raw HTTP contract

The standard request is:

```text
POST /run/:piece/:action
```

### Props body example

Send a JSON object whose fields are the action props.

Example:

```json
{
  "subject": "Hello",
  "body": "It works!"
}
```

There is no extra `propsValue` wrapper for actions. The body itself is the props object.

### Response body

On success, the worker returns:

```json
{
  "ok": true,
  "result": {}
}
```

On action failure inside the worker, it returns:

```json
{
  "ok": false,
  "error": "Action execution failed"
}
```

Other common error shapes:

- `401` with `{ "error": "Unauthorized" }`
- `404` with `{ "error": "Action not found" }`

## Action execution flow inside the worker

The `/run/:piece/:action` path works like this:

1. Parse the piece and action names from the URL.
2. Validate runtime auth with `resolveRuntimeRequestAuth(...)`.
3. Parse the JSON request body into `props`.
4. Look up the piece in the registry.
5. Resolve auth for the piece:
   - OAuth2 token lookup from KV for `X-User-Id`
   - direct token from `X-Piece-Token`
   - local-dev bearer fallback when `RUN_API_KEY` is absent
6. Run the action:
   - native piece → `action.run({ auth, props, env })`
   - AP piece → `action.run(apContext)`
7. Return `{ ok: true, result }`.

This means callers do not need to care whether a piece is native or AP. They just call the action route.

## Gmail example

Gmail is the clearest OAuth2 example.

### Step 1: connect Gmail once

Open:

```text
GET /auth/login/gmail?userId=<your-user-id>
```

Finish the OAuth flow in the browser. The worker stores the token in KV.

### Step 2: call a Gmail action

Example request:

```bash
curl -X POST "https://<your-worker>.workers.dev/run/gmail/send_email" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "X-User-Id: $GMAIL_USER_ID" \
  -d '{
    "receiver": ["your@email.com"],
    "subject": "Hello from freepieces",
    "body": "It works!",
    "body_type": "plain_text"
  }'
```

That call uses:

- `Authorization` for caller auth
- `X-User-Id` to fetch the stored Gmail OAuth token

### Common Gmail actions in this repository

- `send_email`
- `reply_to_email`
- `create_draft_reply`
- `gmail_get_mail`
- `gmail_get_thread`
- `gmail_search_mail`
- `custom_api_call`

## Slack example

Slack is the clearest direct-credential example.

### Bot-token action call

```bash
curl -X POST "https://<your-worker>.workers.dev/run/slack/send_channel_message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "X-Piece-Token: $SLACK_BOT_TOKEN" \
  -d '{
    "channel": "C0123456789",
    "text": "Hello from freepieces",
    "sendAsBot": true
  }'
```

That call uses:

- `Authorization` for caller auth
- `X-Piece-Token` for the Slack bot token

### Why Slack works this way

For AP pieces with `CUSTOM_AUTH`, the worker maps the runtime credential into the auth object that the AP action expects.

In practice, that lets callers send one direct credential instead of constructing the AP auth shape themselves.

## Native API-key example

This repository includes a simple native API-key piece: `example-apikey`.

Example call:

```bash
curl -X POST "https://<your-worker>.workers.dev/run/example-apikey/ping" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "X-Piece-Token: $EXAMPLE_API_KEY" \
  -d '{
    "hello": "world"
  }'
```

The action returns a small success payload and echoes whether auth was configured.

## SDK usage

You do not have to call the raw HTTP endpoints directly.

The SDK wraps the same runtime contract.

### Create a client

```ts
import { createClient } from 'freepieces/sdk';

const client = createClient({
  baseUrl: 'https://<your-worker>.workers.dev',
  token: process.env.RUN_API_KEY,
  userId: process.env.USER_ID,
  pieceToken: process.env.PIECE_TOKEN,
});
```

### Typed action call

```ts
await client.gmail.send_email({
  receiver: ['your@email.com'],
  subject: 'Hello from SDK',
  body: 'It works!',
  body_type: 'plain_text',
});
```

### Generic action call

```ts
await client.run('my-custom-piece', 'my-action', { foo: 'bar' });
```

### Piece proxy by runtime name

```ts
const myPiece = client.piece<{ greet(input: { name: string }): Promise<{ greeting: string }> }>('my-piece');
await myPiece.greet({ name: 'World' });
```

The SDK uses the same auth rules:

- `token` becomes `Authorization: Bearer <RUN_API_KEY>` in secured mode
- `userId` becomes `X-User-Id`
- `pieceToken` becomes `X-Piece-Token`
- in local dev, `pieceToken` or `userId` becomes the bearer fallback

## Actions vs triggers

A quick rule:

- use an **action** when you want to perform an operation now and get the result back
- use a **trigger** when you want to react to events or poll for new data

Examples:

- `send_email` → action
- `send_channel_message` → action
- `gmail_new_email_received` → trigger
- `new-message` for Slack events → trigger

Actions do work. Triggers detect work.

## Common mistakes

### Using the display name in the URL

Use the action `name`, not the human-facing label.

### Forgetting `X-User-Id` for OAuth2 actions when `RUN_API_KEY` is enabled

The worker cannot know which stored OAuth token to use without it.

### Forgetting `X-Piece-Token` for direct-credential actions

If the piece expects a bot token or API key and you do not pass one, the action will fail inside the piece.

### Calling Gmail without completing OAuth first

For Gmail, you need to authorize once before calling actions.

### Expecting `/run/...` to create persistent behavior

It does not. `/run/...` executes now, returns now, and stores nothing except any provider-side changes caused by the action itself.

### Confusing action request bodies with trigger request bodies

Action requests send the props object directly.

Trigger requests use a different envelope such as:

- `payload`
- `propsValue`
- `lastPollMs`

## Troubleshooting

### `401 Unauthorized`

Check:

- is `RUN_API_KEY` configured on the worker?
- are you sending `Authorization: Bearer <RUN_API_KEY>`?
- in local dev, are you sending a reasonable bearer fallback?

### `404 Action not found`

Check:

- the piece name
- the action name
- whether the piece is registered in `/pieces`

### `ok: false, error: "Action execution failed"`

That means the worker caught an exception from the action.

Common causes:

- missing OAuth token
- missing `X-Piece-Token`
- invalid props
- provider-side auth or validation errors

Check worker logs for the real server-side error.

### Gmail says there is no access token

Check:

- did you complete `/auth/login/gmail?userId=...`?
- are you sending the same `X-User-Id` value you used during OAuth?
- is `TOKEN_STORE` configured correctly?

## Quick reference

### Route

```text
POST /run/:piece/:action
```

### Secured headers

```http
Authorization: Bearer <RUN_API_KEY>
X-User-Id: <userId>
X-Piece-Token: <token>
Content-Type: application/json
```

### Request body

```json
{
  "propA": "value",
  "propB": 123
}
```

### Success response

```json
{
  "ok": true,
  "result": {}
}
```

## Source files

If you want to trace the behavior in code, start here:

- `src/worker.ts` — `/run/:piece/:action` and runtime auth resolution
- `src/lib/request-auth.ts` — auth header parsing for runtime endpoints
- `src/framework/types.ts` — native action context and types
- `examples/gmail-example.ts` — OAuth2 action example
- `examples/slack-example.ts` — direct-credential action example
- `examples/sdk-example.ts` — SDK usage
- `src/pieces/example-apikey.ts` — simple native API-key action example
