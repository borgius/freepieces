<!-- markdownlint-disable-file -->

# Task Research Notes: Per-User Action/Trigger Toggles

## Research Executed

### File Analysis

- `AGENTS.md`
  - User-facing behavior changes must keep runtime helpers, Linux shims, SDK/client/examples, README/docs, and tests in sync.
- `src/admin/App.tsx`
  - The admin SPA already resolves the signed-in admin via `getMe()` (`:43-50`), stores `userEmail`, shows it in the navbar (`:133`), and renders `PiecesPage` without any current user-scope prop (`:156`).
- `src/admin/pages/PiecesPage.tsx`
  - The piece detail UX lives here; it renders a grid of `PieceCard`s and already tracks piece-level enable counts (`:38-44`, `:119`).
- `src/admin/components/PieceCard.tsx`
  - Each piece card renders the Actions and Triggers sections via `CollapsibleSection` (`:493-517`), the Users section (`:219-302`), and the existing piece-wide Enable/Disable button (`:428-441`, `:535-541`).
- `src/admin/components/ItemSection.tsx`
  - `ItemRow` is the per-action/per-trigger row renderer (`:32`, `:48`), and the row is currently a literal button (`:69`) that opens the dialog on click (`:81`) with a trailing `ScanSearch` affordance (`:115`).
  - The dialog always shows an `MCP` tab (`:144`); only actions get `Try it` (`:146`).
- `src/admin/components/ItemUsage.tsx`
  - `ItemMcpTab` is piece-level, not item-level; its copy says “All `<piece>` actions are available as MCP tools at this endpoint” (`:502-511`).
- `src/admin/components/AddTriggerForm.tsx`
  - Contains the closest existing checkbox idiom in the admin UI (`:26-29`, `:87-89`).
- `src/admin/lib/api.ts`
  - Admin data models expose `PieceAction`, `PieceTrigger`, and `PieceInfo` but no per-item enabled flags (`:58-91`).
  - Admin fetch helpers include `listPieces()` (`:122`), `listPieceUsers()` (`:134`), `getMe()` (`:118-119`), and `runActionAsAdmin()` (`:245`).
- `src/routes/admin-api.ts`
  - Session state stores both `sub` and `email` (`:216`), but `GET /admin/api/me` returns only `email` (`:223-224`).
  - `GET /admin/api/pieces` enriches admin piece data with secrets, `supportsUsers`, `hasAutoUserId`, and the existing piece-wide `enabled` flag (`:241-280`).
  - `GET /admin/api/pieces/:name/users` lists stored OAuth user IDs (`:286-300`).
  - Piece install/uninstall persist the current piece-level flag (`:368-380`).
  - Admin trigger subscription creation and action execution live at `POST /admin/api/subscriptions/:piece/:trigger` (`:384`) and `POST /admin/api/run/:piece/:action` (`:580`).
- `src/framework/registry.ts`
  - Source of truth for normalized piece metadata, actions, triggers, secret groups, and per-piece MCP endpoint generation (`:105-122`, `:156`, `:236-313`, `:349`, `:358`).
- `src/lib/admin-config.ts`
  - The only persisted toggle pattern today is `PIECE_FLAG(name) => __admin:enabled:<name>` with default-enabled semantics (`:13-17`).
  - The rest of the helpers only detect stored-user/auth characteristics (`:164-174`).
- `src/lib/token-store.ts`
  - Per-user persistence exists today only for encrypted OAuth tokens under `token:<pieceName>:<userId>` (`:14-18`, `:26-48`, `:64-95`).
- `src/lib/webhook.ts`
  - Trigger subscriptions persist as `sub:<piece>:<id>` and subscription ownership is keyed by runtime credentials via `sameSubscriptionOwner()` (`:16-55`, `:104-182`).
- `src/lib/polling.ts`
  - POLLING triggers are executed out-of-band by the scheduler and currently never consult any enable/disable state (`:20`, `:26-50`, `:108`).
- `src/routes/runtime-api.ts`
  - Direct action execution is routed through `/run/:piece/:action` (`:25`) and direct trigger execution through `/trigger/:piece/:trigger` (`:95`), with 404s based only on missing piece/action/trigger today (`:30`, `:54`, `:77`, `:103`, `:117`).
- `src/routes/mcp-api.ts`
  - MCP exposes actions only, not triggers: `nativeTools()`/`apTools()` derive tools from actions (`:106-115`), `tools/list` returns them (`:216`), and `tools/call` invokes them via `runTool()` (`:158`, `:221`).
  - MCP currently advertises `capabilities: { tools: {} }` without `listChanged` (`:205-206`) and still uses `MCP_PROTOCOL_VERSION = '2024-11-05'` (`:18`).
- `src/routes/webhook-api.ts`
  - Webhook fan-out entrypoint is `/webhook/:piece` (`:109`), subscription create is `/subscriptions/:piece/:trigger` (`:159`), subscription list is `/subscriptions/:piece` (`:239`), and delete is `/subscriptions/:piece/:trigger/:id` (`:257`).
- `src/worker/create-worker.ts`
  - Mounts `/pieces`, runtime, MCP, admin, and webhook routes together (`:61`, `:92-115`) and also drives webhook relay in `queue()` (`:122`) plus scheduled polling in `scheduled()` (`:141`).
- `src/linux-server.ts`
  - Linux/self-hosted mode reuses the same `TOKEN_STORE` via file-backed KV (`:32`) and the same polling runner (`:121`).
- `src/lib/linux-kv.ts`
  - Any new KV key prefix automatically persists in Linux mode through the generic file-backed KV shim (`:27`, `:38`, `:46`, `:54`).
- `src/sdk/types.ts`, `src/sdk/client.ts`
  - Public runtime discovery uses `PieceSummary` from `/pieces`; it has `actions` and `triggers` but no per-item enabled state (`src/sdk/types.ts:77-85`, `src/sdk/client.ts:198`).
- `README.md`, `docs/mcp.mdx`, `docs/auth.mdx`
  - Public docs currently promise that every registered piece becomes an MCP server with one tool per action (`README.md:28`, `:132-160`; `docs/mcp.mdx:17-24`, `:82`, `:113-114`).
  - `docs/auth.mdx` explicitly says `FREEPIECES_TOKEN_STORE` stores encrypted OAuth tokens and admin state (`:82`), lists admin piece-enabled flags as current admin state (`:127`), and documents the OAuth token KV key format (`:495`).
- `src/worker/create-worker.test.ts`, `src/worker.test.ts`, `src/lib/token-store.test.ts`, `src/sdk/client.test.ts`, `src/sdk/client.retry.test.ts`
  - Existing tests cover MCP listing/calling, admin stored-user discovery, admin trigger grouping and subscription creation, token-store pagination, and SDK trigger/listPieces behavior (`create-worker.test.ts:117-298`, `worker.test.ts:128-143`, `:501-735`, `token-store.test.ts:5-44`, `sdk/client.test.ts:100`, `sdk/client.retry.test.ts:59-98`).

### Code Search Results

- `allowlist|denylist|preferences|prefs|enabledActions|enabledTriggers|disabledActions|disabledTriggers|toolPreferences|piecePreferences`
  - No matches in `src/**`; there is no existing per-user item-toggle persistence model.
- `isPieceEnabled|PIECE_FLAG`
  - Matches only `src/lib/admin-config.ts` and `src/routes/admin-api.ts`; the current piece-wide enable/disable flag is admin-only and not enforced in `runtime-api.ts`, `mcp-api.ts`, `webhook-api.ts`, `dispatchWebhook()`, or `runAllPollingTriggers()`.
- `tools/list|tools/call|mcp`
  - MCP behavior is concentrated in `src/routes/mcp-api.ts`; related admin/docs surfaces are `src/admin/components/ItemUsage.tsx`, `src/admin/components/PieceMcpSection.tsx`, `README.md`, and `docs/mcp.mdx`.
- `runtimeApi.all('/run/:piece/:action')|runtimeApi.post('/trigger/:piece/:trigger')|webhookApi.post('/subscriptions/:piece/:trigger')|dispatchWebhook|runAllPollingTriggers`
  - Action/trigger execution is split across direct REST calls, MCP tool calls, webhook subscription create/list/delete, webhook fan-out, queue relay, and scheduled polling.
- `type="checkbox"`
  - Existing checkbox precedent in the admin UI is `src/admin/components/AddTriggerForm.tsx:87-89`.
- `getMe\(|userEmail|session\.sub|/admin/api/me`
  - The admin SPA already resolves the signed-in user, but the current client only sees `email`; the runtime-stable `sub`/`userId` is available server-side and not yet exposed to the SPA.

### External Research

- #fetch:https://modelcontextprotocol.io/specification/latest/server/tools
  - Latest MCP tools guidance (2025-11-25) defines `tools/list` as the discovery surface, `tools/call` as the invocation surface, and unknown tools as JSON-RPC protocol errors (`-32602 "Unknown tool: ..."`) rather than tool-result payload errors.
  - The same spec supports dynamic tool availability via `listChanged`; the current repo does not advertise that capability.
- #fetch:https://modelcontextprotocol.io/specification/latest/basic/transports
  - Streamable HTTP expects JSON-RPC requests via HTTP `POST` and JSON-RPC responses via JSON or SSE.
  - HTTP 404 is documented for ended MCP sessions and backwards-compatibility flows, not as the default “unknown tool” signal.
  - Returning literal HTTP 404 for disabled MCP tool calls is therefore a product decision that trades off against the spec’s default protocol-error pattern.

### Project Conventions

- Standards referenced: `AGENTS.md`; `package.json` scripts (`npm test`, `npm run check`, `npm run build`); Cloudflare/Workers guidance loaded from the `cloudflare` and `workers-best-practices` skills; prose guidance loaded from the `writing-clearly-and-concisely` skill.
- Instructions followed: research-only scope; only `/.copilot-tracking/research/` may be modified; no `.github/instructions/**` or `copilot/**` files were present in this workspace.

## Key Discoveries

### Project Structure

The admin “piece detail” UI is a three-layer stack:

1. `src/admin/pages/PiecesPage.tsx` renders the piece grid.
2. `src/admin/components/PieceCard.tsx` renders each piece card, piece-wide enable/disable, user management, secrets, and the Actions/Triggers sections.
3. `src/admin/components/ItemSection.tsx` renders each individual action/trigger row (`ItemRow`) and the detail dialog.

That makes `ItemRow` the real target for an action/trigger checkbox. `TriggersPanel` in Settings is about active subscriptions, not piece metadata or per-tool visibility.

One UI wrinkle matters immediately: `ItemRow` is currently rendered as a button (`src/admin/components/ItemSection.tsx:69`) with an `onClick` that opens the dialog (`:81`). A native checkbox inside that button would be invalid nested interactive HTML and would be hard to keep from opening the dialog. The row needs to be split into a non-button wrapper plus separate “open details” and “toggle enabled” controls if the checkbox is going to live “in the corner” cleanly.

Another UX mismatch already exists: trigger rows show the same `MCP` tab as action rows (`src/admin/components/ItemSection.tsx:144`), but the tab copy says “All `<piece>` actions are available as MCP tools” (`src/admin/components/ItemUsage.tsx:511`). That is evidence that current MCP is action-only and that trigger-facing MCP copy is already misleading.

### Implementation Patterns

There is one existing enable/disable persistence pattern in the repo, but it is incomplete for this feature:

- `src/lib/admin-config.ts:13-17` defines `PIECE_FLAG(name) => __admin:enabled:<name>` with default-enabled semantics.
- `src/routes/admin-api.ts:280,372,380` reads and writes that flag for the admin piece list and the piece-wide Enable/Disable button.
- No runtime surface checks that flag. `runtime-api.ts`, `mcp-api.ts`, `webhook-api.ts`, `dispatchWebhook()`, and `runAllPollingTriggers()` never consult it.

That existing piece toggle is useful as a naming/style precedent—small namespaced KV key, default true—but it is not a behavior precedent. For per-user action/trigger toggles, a shared runtime helper is required or the feature will leak around the edges.

Current per-user persistence is limited to:

- encrypted OAuth tokens: `token:<pieceName>:<userId>` (`src/lib/token-store.ts:14-48`)
- stored subscriptions: `sub:<piece>:<id>` (`src/lib/webhook.ts:45-49`)
- trigger scheduler cursors: `poll_ms:<subId>` (`src/lib/polling.ts:20`)
- AP trigger state: `trigstate:<piece>:<trigger>:<userId>:...` (`src/lib/ap-context.ts:152-171`)
- admin piece flags: `__admin:enabled:<piece>` (`src/lib/admin-config.ts:13`)
- test webhook events: `test_event:...` (`src/routes/webhook-api.ts:72-96`, `src/routes/admin-api.ts:557-575`)

There is no stored “preferences” or “tool visibility” document anywhere in `src/**`.

Routing is broader than it first appears:

- direct action execution: `src/routes/runtime-api.ts:25`
- direct trigger execution: `src/routes/runtime-api.ts:95`
- MCP tool list/call: `src/routes/mcp-api.ts:216-221`
- subscription create/list/delete: `src/routes/webhook-api.ts:159,239,257`
- webhook fan-out: `src/lib/webhook.ts:182`
- scheduled POLLING delivery: `src/lib/polling.ts:26`
- queue relay + scheduler entrypoints: `src/worker/create-worker.ts:122,141`

If a trigger is “disabled” only at `/trigger`, existing subscriptions will still run through webhook fan-out or scheduled polling. So trigger gating is fundamentally broader than action gating.

### Complete Examples

```ts
// `src/admin/components/ItemSection.tsx:48-115`
// Current per-item UI row: it opens a dialog and already reserves a trailing corner affordance.
function ItemRow(...) {
  return (
    <Flex
      as="button"
      w="full"
      ...
      onClick={() => setDialogOpen(true)}
    >
      ...
      <Box color="gray.300" flexShrink={0}>
        <ScanSearch size={13} />
      </Box>
    </Flex>
  );
}

// `src/routes/mcp-api.ts:106-115,216-221`
// Current MCP exposure is action-only.
function nativeTools(piece: PieceDefinition): McpTool[] {
  return piece.actions.map((action) => ({
    name: action.name,
    title: action.displayName,
    description: action.description ?? `${action.displayName}.`,
    inputSchema: propsToInputSchema(action.props),
  }));
}

switch (request.method) {
  case 'tools/list':
    return success(request.id, {
      tools: stored.kind === 'native' ? nativeTools(stored.def) : apTools(stored.piece),
    });

  case 'tools/call': {
    ...
    const result = await runTool(pieceName, params.name, args, env, credentials);
    return success(request.id, {
      content: [{ type: 'text', text: textContent(result) }],
      structuredContent: result,
    });
  }
}

// `src/lib/admin-config.ts:13-17`
// Existing default-enabled deny-by-exception pattern.
export const PIECE_FLAG = (name: string): string => `__admin:enabled:${name}`;

export async function isPieceEnabled(kv: KVNamespace, name: string): Promise<boolean> {
  const flag = await kv.get(PIECE_FLAG(name));
  return flag !== 'false';
}
```

### API and Schema Documentation

Current admin-side piece schema:

- `src/admin/lib/api.ts:58-63` — `PieceAction`
  - `name`, `displayName`, `description`, `props`
- `src/admin/lib/api.ts:65-70` — `PieceTrigger`
  - `name`, `displayName`, `description`, `type`, `props`
- `src/admin/lib/api.ts:78-91` — `PieceInfo`
  - `name`, `displayName`, `description`, `version`, `auth`, `mcpEndpoint`, `actions`, `triggers`, `secrets`, `supportsUsers`, `hasAutoUserId`, `enabled`

Current normalized runtime piece schema:

- `src/framework/registry.ts:236-244` — `PieceSummaryEntry`
  - `actions` and `triggers` are normalized arrays generated from native or AP definitions.
  - `mcpEndpoint` is derived here (`:288`, `:313`).

Current persistence/storage facts:

- `src/lib/token-store.ts:14-18`
  - OAuth tokens: `token:<pieceName>:<userId>`
- `src/lib/webhook.ts:45-49`
  - Subscriptions: `sub:<piece>:<id>`
- `src/lib/polling.ts:20`
  - Poll cursors: `poll_ms:<subId>`
- `src/lib/ap-context.ts:171`
  - AP trigger state: `trigstate:<piece>:<trigger>:<userId>:...`
- `src/lib/admin-config.ts:13`
  - Piece-wide admin flag: `__admin:enabled:<piece>`

Current public/runtime APIs relevant to the feature:

- `GET /pieces` — public piece discovery (`src/worker/create-worker.ts:61`)
- `POST /run/:piece/:action` — action execution (`src/routes/runtime-api.ts:25`)
- `POST /trigger/:piece/:trigger` — direct trigger execution (`src/routes/runtime-api.ts:95`)
- `POST /subscriptions/:piece/:trigger` — trigger subscription create (`src/routes/webhook-api.ts:159`)
- `POST /mcp/:piece` — MCP JSON-RPC endpoint (`src/routes/mcp-api.ts:257`)
- `GET /mcp/:piece` — piece/tool metadata (`src/routes/mcp-api.ts:244`)

Current admin APIs relevant to the feature:

- `GET /admin/api/me` — current admin identity, but currently email-only (`src/routes/admin-api.ts:223-224`)
- `GET /admin/api/pieces` — admin piece metadata (`src/routes/admin-api.ts:242`)
- `GET /admin/api/pieces/:name/users` — stored OAuth user IDs for a piece (`src/routes/admin-api.ts:287`)
- `POST /admin/api/run/:piece/:action` — admin action proxy used by the existing “Try it” tab (`src/routes/admin-api.ts:581`)
- `POST /admin/api/subscriptions/:piece/:trigger` — admin trigger subscription creation (`src/routes/admin-api.ts:385`)

External MCP contract facts from authoritative docs:

- `tools/list` is the discovery API and should reflect the currently available tool set.
- Unknown tools are represented as JSON-RPC protocol errors, not ordinary tool-result payloads.
- Transport-level HTTP 404 is used by the spec for ended sessions / compatibility scenarios, not as the default way to report “unknown tool”.

### Configuration Examples

```text
Current KV keyspace patterns in this repo

__admin:enabled:<piece>
token:<piece>:<userId>
sub:<piece>:<subscriptionId>
poll_ms:<subscriptionId>
trigstate:<piece>:<trigger>:<userId>:<key>
test_event:<timestamp>:<id>

Recommended new key family

__admin:user-tool-state:<userId>:<piece>
  {
    "version": 1,
    "disabledActions": ["action_a", "action_b"],
    "disabledTriggers": ["trigger_a"]
  }
```

### Technical Requirements

- Default semantics should be “all enabled” so new actions/triggers automatically appear without backfilling every user.
- The admin UI needs per-item enabled state on `actions[]` and `triggers[]` or a parallel lookup result.
- The row-level checkbox must not be rendered as an interactive child inside the existing `ItemRow` button.
- MCP filtering only applies to actions today, because the repo does not expose triggers as MCP tools:
  - code: `src/routes/mcp-api.ts:106-115,216`
  - docs: `README.md:28,132-160`, `docs/mcp.mdx:20,82,113-114`
- Trigger disablement must cover:
  - direct `/trigger`
  - `/subscriptions` create
  - webhook fan-out `dispatchWebhook()`
  - scheduled polling `runAllPollingTriggers()`
- Existing subscriptions should probably remain stored but go dormant while a trigger is disabled, so re-enabling does not require re-subscribing.
- Deleting a subscription should still remain possible even if the trigger is disabled.
- No existing env var or binding change is required if the feature reuses `TOKEN_STORE`.
- The admin SPA needs a runtime-stable user identifier. Today it only has `email`, while the server session stores both `sub` and `email`; those are not guaranteed to be identical.
- Product decision still needed: does “per-user” mean only the current signed-in admin user for v1, or must admins manage other runtime users from the same screen? Current UI has no cross-user selector.
- Product decision still needed: should direct-token-only callers (no stable `userId`) be out of scope for v1, or should the feature invent a principal model for `pieceToken` / `pieceAuthProps`? There is no current UI or persistence surface for that.
- Product decision still needed: for MCP `tools/call`, should a disabled tool produce literal HTTP 404 to satisfy the product wording, or a spec-friendly JSON-RPC protocol error that behaves like “unknown tool”?
- Validation should include `npm test`, `npm run check`, and `npm run build` (`package.json:53,65,66`).

## Recommended Approach

Use a **per-user, per-piece JSON denylist** stored in `TOKEN_STORE`, and treat the **current admin session `sub` / userId** as the default user scope in the admin UI.

Why this is the least disruptive design in this repo:

1. **It matches the required default behavior.**
   - A missing record means “everything enabled”.
   - New actions/triggers are auto-enabled without migration work.

2. **It reuses the only user identity already wired through the admin surface.**
   - `src/routes/admin-api.ts:216` already has a stable `sub` / userId in session state.
   - The admin SPA already calls `getMe()`, so expanding that payload is a tiny admin-only contract change.

3. **It keeps reads cheap and shared.**
   - One KV `get()` per `(userId, piece)` can drive:
     - admin checkbox state,
     - MCP tool filtering,
     - REST 404 gates,
     - webhook/polling skip logic.

4. **It avoids repeating the current piece-toggle mistake.**
   - The piece-wide flag pattern is a good naming precedent, but not a runtime precedent.
   - A dedicated shared helper can be used everywhere runtime behavior is decided.

Recommended storage shape:

```json
{
  "version": 1,
  "disabledActions": ["send_email", "archive_message"],
  "disabledTriggers": ["gmail_new_email_received"]
}
```

Recommended KV key:

```text
__admin:user-tool-state:<userId>:<piece>
```

Use denylist semantics, not allowlist semantics:

- missing key = everything enabled
- missing item = enabled
- new upstream actions/triggers = automatically enabled
- smaller documents when most items stay enabled

Recommended server helper surface:

- `loadUserToolState(kv, userId, pieceName)`
- `isActionEnabledForUser(kv, userId, pieceName, actionName)`
- `isTriggerEnabledForUser(kv, userId, pieceName, triggerName)`
- optionally `setActionEnabledForUser(...)` / `setTriggerEnabledForUser(...)`

Recommended admin API changes:

1. Extend `GET /admin/api/me`
   - Return both `{ userId: c.var.session.sub, email: c.var.session.email }`.
   - Keep `email` for display; use `userId` as the toggle-state key.

2. Extend `GET /admin/api/pieces`
   - Resolve the effective `userId` from the admin session user by default.
   - Add `enabled: boolean` to each action and trigger item in the admin response only.
   - Keep the public `GET /pieces` / SDK `PieceSummary` unchanged unless product explicitly wants runtime discovery to become user-scoped too.

3. Add a single admin toggle route
   - Example shape: `PATCH /admin/api/pieces/:piece/:kind/:name`
   - Body: `{ enabled: boolean, userId?: string }`
   - `kind` is `action` or `trigger`
   - If `userId` is omitted, default to the current admin session userId
   - This keeps the UI call site simple and leaves room for a future cross-user selector without a storage migration

Recommended admin UI changes:

- `src/admin/App.tsx`
  - Store both `userId` and `email` from `getMe()`.
  - Pass the current `userId` into `PiecesPage` (or a lightweight context).
- `src/admin/lib/api.ts`
  - Add per-item `enabled` to the admin-only `PieceAction` / `PieceTrigger` types.
  - Expand `getMe()` to return `{ userId, email }`.
  - Add a `setPieceItemEnabled(...)` client helper for the toggle route.
- `src/admin/components/ItemSection.tsx`
  - Refactor `ItemRow` from “row is a button” to “row is a container with a detail-open control and a separate checkbox control”.
  - Put the checkbox in the current trailing affordance area where `ScanSearch` lives.
- `src/admin/components/PieceCard.tsx`
  - No new surface is required for the first pass beyond threading the current user scope and updated item shapes into `CollapsibleSection`.

Recommended runtime enforcement points:

- **Actions**
  - `src/routes/runtime-api.ts:25` — return 404 for disabled action
  - `src/routes/mcp-api.ts:244` — filter disabled actions from `GET /mcp/:piece`
  - `src/routes/mcp-api.ts:216` — filter disabled actions from `tools/list`
  - `src/routes/mcp-api.ts:221` — gate `tools/call`
  - `src/routes/admin-api.ts:581` — gate the admin “Try it” proxy if that UI is meant to reflect the same user scope

- **Triggers**
  - `src/routes/runtime-api.ts:95` — return 404 for disabled direct trigger invocation
  - `src/routes/webhook-api.ts:159` — return 404 when creating a new subscription for a disabled trigger
  - `src/lib/webhook.ts:182` — skip disabled subscriptions during webhook fan-out
  - `src/lib/polling.ts:26-50` — skip disabled subscriptions during scheduled polling
  - `src/routes/admin-api.ts:385` — gate admin-created subscriptions as well, or the admin UI can create dormant subscriptions unexpectedly

Important nuance: do not block `DELETE /subscriptions/:piece/:trigger/:id` solely because the trigger is disabled. Users still need a cleanup path for existing stored subscriptions.

Recommended sync surfaces per `AGENTS.md`:

- **Worker/runtime helpers**
  - `src/worker.ts`
  - `src/worker/create-worker.ts`
  - `src/routes/admin-api.ts`
  - `src/routes/runtime-api.ts`
  - `src/routes/mcp-api.ts`
  - `src/routes/webhook-api.ts`
  - `src/lib/polling.ts`
  - new shared helper(s) under `src/lib/` for per-user tool state
- **Linux shims**
  - `src/linux-server.ts`
  - `src/lib/linux-kv.ts`
  - `src/lib/linux-email.ts` only if auth/env behavior changes (not obviously needed for this design)
- **Admin UI**
  - `src/admin/App.tsx`
  - `src/admin/lib/api.ts`
  - `src/admin/pages/PiecesPage.tsx`
  - `src/admin/components/PieceCard.tsx`
  - `src/admin/components/ItemSection.tsx`
  - possibly `src/admin/components/ItemUsage.tsx` / `src/admin/components/PieceMcpSection.tsx` if wording needs to acknowledge filtered tool availability
- **SDK/client/examples**
  - `src/sdk/types.ts`, `src/sdk/client.ts` only if public `/pieces` or SDK discovery becomes user-scoped
  - `src/client/script-client.ts`
  - `examples/sdk-example.ts`
  - `examples/slack-example.ts`
  - any other example or client that claims all actions/tools are always available
- **CLI scaffolding/config/help text**
  - `src/cli/**` only if the implementation introduces new flags or env vars; this research found no direct CLI surface for per-tool visibility beyond existing `RUN_API_KEY` / `TOKEN_STORE` setup copy
- **Docs**
  - `README.md`
  - `docs/mcp.mdx`
  - `docs/actions.mdx`
  - `docs/triggers.mdx`
  - `docs/auth.mdx`
  - `docs/pieces.mdx`
  - any admin-UI doc copy that mentions enable/disable behavior
- **Tests**
  - `src/worker/create-worker.test.ts`
  - `src/worker.test.ts`
  - a new dedicated helper test file under `src/lib/`
  - `src/lib/token-store.test.ts` only if token-store abstractions are reused or extended
  - `src/lib/webhook.test.ts`
  - `src/sdk/client.test.ts` / `src/sdk/client.retry.test.ts` if SDK-facing behavior changes

## Implementation Guidance

- **Objectives**:
  - Add per-user item visibility/state to the admin piece detail UI with default-all-enabled semantics.
  - Filter MCP tool discovery to enabled actions only for the effective user.
  - Return 404 on disabled REST action/trigger invocation and suppress disabled trigger delivery in background paths.
  - Keep storage small, backwards-compatible, and Linux-compatible by reusing `TOKEN_STORE`.

- **Key Tasks**:
  - Add a shared per-user tool-state helper in `src/lib/`.
  - Expand `GET /admin/api/me` so the SPA has a stable `userId` in addition to display `email`.
  - Extend admin piece metadata with per-item enabled booleans.
  - Refactor `ItemRow` so a checkbox can coexist with the row’s detail-open affordance.
  - Add one admin toggle endpoint and one admin client helper.
  - Gate `/run`, `/trigger`, admin `/run`, admin `/subscriptions`, runtime `/subscriptions`, `dispatchWebhook()`, `runAllPollingTriggers()`, and MCP `GET /mcp/:piece` / `tools/list` / `tools/call`.
  - Update docs that currently promise “every action” is always exposed as an MCP tool.

- **Dependencies**:
  - Existing `TOKEN_STORE` KV binding / Linux file-backed KV.
  - Existing admin session state in `src/routes/admin-api.ts`.
  - Existing runtime auth resolution in `src/lib/request-auth.ts`.
  - Existing piece/action/trigger metadata from `src/framework/registry.ts`.

- **Success Criteria**:
  - Admin Pieces UI shows a working per-item checkbox without invalid nested-button markup.
  - Missing per-user state means all actions/triggers remain enabled.
  - Disabled actions disappear from MCP `GET /mcp/:piece` and `tools/list` for the effective user.
  - Disabled REST actions/triggers return 404.
  - Disabled triggers stop delivering via direct `/trigger`, webhook fan-out, and scheduled polling.
  - Existing subscriptions remain removable even when their trigger is disabled.
  - `npm test`, `npm run check`, and `npm run build` all pass after implementation.