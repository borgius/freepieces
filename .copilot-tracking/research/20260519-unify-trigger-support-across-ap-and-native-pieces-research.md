<!-- markdownlint-disable-file -->

# Task Research Notes: Unify Trigger Support Across AP and Native Pieces

## Research Executed

### File Analysis

- `src/routes/webhook-api.ts`
  - `POST /webhook/:piece` and `POST /subscriptions/:piece/:trigger` both return `404` unless the registry entry resolves to `stored.kind === 'ap'`, which is the immediate reason native pieces cannot use webhook subscriptions.
- `src/lib/webhook.ts`
  - `dispatchWebhook(pieceName, piece: ApPiece, payload, env)` accepts only `ApPiece`, resolves auth with `resolveApRuntimeAuth`, and always builds contexts with `buildApTriggerContext`, so queue/webhook fan-out is structurally AP-only.
- `src/routes/runtime-api.ts`
  - Direct `/trigger/:piece/:trigger` supports both native and AP pieces, but the execution contract is split: native triggers receive `{ auth, props, lastPollMs, env, refreshAuth }`, while AP triggers receive `{ propsValue, payload, app, store, files, ... }` through `buildApTriggerContext(...)`.
- `src/framework/types.ts`
  - Native `PieceTrigger` only supports `type: 'POLLING'` and `run(ctx: PieceTriggerContext)`, while `ApTrigger` supports strategy strings plus lifecycle hooks (`onEnable`, `onDisable`).
- `src/lib/ap-context.ts`
  - The AP shim provides a no-op `store`, a no-op `app.createListeners()`, and no `webhookUrl`, which means current AP trigger support is only sufficient for filter-style `run()` execution against an already-arrived payload.
- `src/compat/activepieces.ts`
  - The compat layer exports `createPiece`, `createAction`, `PieceAuth`, and `Property`, but no `createTrigger` or `TriggerStrategy`, so non-AP authored pieces cannot use standard Activepieces trigger builders today.
- `src/pieces/gmail.ts`
  - Gmail is the only native piece with triggers, and every Gmail trigger is declared as `type: 'POLLING'`; state is passed in from the caller using `lastPollMs` and trigger-specific props rather than a persistent trigger store.
- `src/pieces/index.ts`
  - Native pieces are registered with `registerPiece(...)`; upstream Activepieces packages are registered separately via side-effect wrappers that call `registerApPiece(...)`.
- `src/admin/components/ItemUsage.tsx`
  - The admin UI decides between “Subscribe” and “Poll” entirely from `triggerType`; it is not hardcoded to AP pieces, so once native pieces can advertise webhook-capable strategies, the existing UI structure can expose them.
- `src/worker/create-worker.ts`
  - The Worker `queue()` entrypoint re-injects raw provider payloads through `dispatchWebhook(...)` and also rejects non-AP pieces, so queued inbound webhook processing is AP-only too.
- `src/sdk/client.ts`
  - The SDK only exposes direct trigger execution with `{ propsValue?, lastPollMs?, payload? }`; there is no subscription API and no trigger state lifecycle abstraction.
- `README.md`, `docs/triggers.mdx`, `docs/pooling.mdx`, `docs/pieces.mdx`
  - User-facing docs are aligned with the code: subscriptions are documented as AP-only, while Gmail/native triggers are documented as direct polling.
- `src/worker.test.ts`
  - Tests cover queue-backed Slack subscriptions and subscription validation, but there is no native trigger subscription coverage and no lifecycle-hook coverage for AP or native triggers.

### Code Search Results

- `stored.kind !== 'ap'|stored.kind === 'ap'`
  - Matches in `src/routes/webhook-api.ts` and `src/worker/create-worker.ts` confirm the webhook/subscription path is gated by piece kind rather than trigger capability.
- `createTrigger|TriggerStrategy|APP_WEBHOOK|WEBHOOK|POLLING`
  - `src/**` contains type references for AP trigger strategies but no framework/compat implementation of `createTrigger`, which confirms that native/ported pieces cannot author standard AP triggers in this repository today.
- `webhookUrl|createListeners|store:|lastPollMs`
  - `webhookUrl` only appears in subscription responses/docs, `createListeners` is a no-op in `src/lib/ap-context.ts`, `store` is transient/no-op there as well, and `lastPollMs` only appears on the native polling path.
- `triggers:\s*\[|type:\s*'POLLING'|type:\s*'WEBHOOK'|type:\s*'APP_WEBHOOK'`
  - Under `src/pieces/**`, only `src/pieces/gmail.ts` declares native triggers today, and all five of them are `POLLING`.
- `createTrigger|TriggerStrategy|webhookUrl|onEnable|onDisable|pollingHelper` in `node_modules/@activepieces/pieces-framework/**`
  - The installed Activepieces framework package defines `createTrigger`, `TriggerStrategy`, strategy-specific trigger contexts, `webhookUrl`, `setSchedule`, lifecycle hooks, handshake hooks, renew hooks, and `sampleData`/`test` behavior that freepieces does not currently expose to native pieces and only partially exposes to AP pieces.

### External Research

- #githubRepo:"activepieces/activepieces createTrigger TriggerStrategy onEnable onDisable webhookUrl"
  - The upstream Activepieces project and its published framework define triggers as strategy-specific runtime objects with lifecycle hooks and context features that the current freepieces trigger runtime only approximates.
- #fetch:https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/overview.md
  - Activepieces documents three trigger strategies (`POLLING`, `WEBHOOK`, `APP_WEBHOOK`) and a standard trigger structure with `run`, `onEnable`, `onDisable`, `sampleData`, and context access to `store`, `webhookUrl`, `payload`, and `propsValue`.
- #fetch:https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/polling-trigger.md
  - Activepieces polling triggers rely on `onEnable` plus persistent state via `context.store` or the polling helper library; the platform, not the caller, normally owns cursor persistence.
- #fetch:https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/webhook-trigger.md
  - Activepieces webhook triggers expect the runtime to provide `context.webhookUrl`, invoke `onEnable`/`onDisable` around provider registration, and route inbound payloads through `context.payload.body`.
- #fetch:https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
  - Cloudflare recommends `ctx.waitUntil()` for post-response webhook work and Queues for async/background processing, which matches the current freepieces fan-out architecture and should remain the delivery pattern after trigger unification.

### Project Conventions

- Standards referenced: `AGENTS.md`, `package.json` scripts (`npm test`, `npm run check`), `docs/triggers.mdx`, `docs/pooling.mdx`, `docs/pieces.mdx`, and the `workers-best-practices` skill.
- Instructions followed: keep worker/runtime helpers, SDK, examples, README, docs, and tests in sync for any public behavior change; preserve Cloudflare queue + `waitUntil()` delivery patterns; avoid hardcoded personal identifiers.

## Key Discoveries

### Project Structure

This repository has two runtime piece models:

1. **Native pieces** registered through `registerPiece(...)`
2. **Upstream Activepieces pieces** registered through `registerApPiece(...)`

The action runtime supports both models, but the trigger runtime is split into two unrelated paths:

- direct `/trigger/...` execution branches on piece kind
- webhook/subscription execution only accepts AP pieces

That split is why native triggers can be polled but cannot participate in webhook subscriptions, queue fan-out, or queued inbound webhook reprocessing.

The deeper compatibility gap is bigger than the AP-only route guard:

- native triggers cannot declare AP-style strategies or lifecycle hooks
- the compat layer does not export a trigger builder
- the AP trigger shim lacks real `store`, `webhookUrl`, handshake, and scheduling support

So freepieces currently has **partial AP trigger compatibility** and **native-only polling semantics** rather than one unified trigger contract.

### Implementation Patterns

The current implementation follows these patterns:

- **Capability is inferred from piece kind instead of trigger definition**
  - `stored.kind === 'ap'` is treated as the prerequisite for subscriptions and inbound webhook dispatch.
- **Native polling is caller-managed**
  - Native polling triggers expect the caller to persist `lastPollMs` and any trigger-specific state outside the worker.
- **AP webhook support is filter-and-fan-out, not full lifecycle management**
  - freepieces receives inbound payloads at `/webhook/:piece`, runs `trigger.run(...)`, and forwards matches to a callback or queue, but it does not currently execute full AP lifecycle responsibilities such as `onEnable`, `onDisable`, `onHandshake`, `onRenew`, or a durable trigger store.
- **Admin usage rendering is already strategy-driven**
  - The UI uses `triggerType` to choose polling vs subscription examples, which means the UI can benefit immediately once the runtime starts exposing native webhook-capable trigger types.
- **The only native trigger migration surface today is Gmail**
  - Gmail is the sole native piece with triggers, which keeps the initial migration blast radius small while still requiring a framework-level design that can support future native triggers.

### Complete Examples

```typescript
// Current hard gate in freepieces
// Source: src/routes/webhook-api.ts
const stored = getPiece(pieceName);
if (!stored || stored.kind !== 'ap') {
  return c.json({ error: 'Piece not found or not an AP piece' }, 404);
}

// Current native vs AP trigger type split
// Source: src/framework/types.ts
export interface PieceTrigger {
  name: string;
  displayName: string;
  type: 'POLLING';
  run(ctx: PieceTriggerContext): Promise<unknown[]>;
}

export interface ApTrigger {
  name: string;
  displayName: string;
  type: string; // 'APP_WEBHOOK' | 'WEBHOOK' | 'POLLING' | ...
  run(context: unknown): Promise<unknown[]>;
  onEnable?(context: unknown): Promise<void>;
  onDisable?(context: unknown): Promise<void>;
}

// Upstream Activepieces trigger contract in the installed framework package
// Source: node_modules/@activepieces/pieces-framework/src/lib/context/index.d.ts
type PollingTriggerHookContext<PieceAuth, TriggerProps> = BaseContext<PieceAuth, TriggerProps> & {
  setSchedule(schedule: { cronExpression: string; timezone?: string }): void;
};

type WebhookTriggerHookContext<PieceAuth, TriggerProps> = BaseContext<PieceAuth, TriggerProps> & {
  webhookUrl: string;
  payload: TriggerPayload;
  server: ServerContext;
};

// Source: node_modules/@activepieces/pieces-framework/src/lib/trigger/trigger.d.ts
type BaseTriggerParams<PieceAuth, TriggerProps, TS extends TriggerStrategy> = {
  onEnable: (context: TriggerHookContext<PieceAuth, TriggerProps, TS>) => Promise<void>;
  onDisable: (context: TriggerHookContext<PieceAuth, TriggerProps, TS>) => Promise<void>;
  run: (context: TestOrRunHookContext<PieceAuth, TriggerProps, TS>) => Promise<unknown[]>;
  sampleData: unknown;
};
```

### API and Schema Documentation

Current runtime contracts that matter for this task:

- `POST /trigger/:piece/:trigger`
  - Works for both native and AP pieces.
  - Native trigger request body uses `propsValue` plus `lastPollMs`.
  - AP trigger request body uses `propsValue` plus `payload`.
- `POST /subscriptions/:piece/:trigger`
  - Creates a persistent subscription record in KV with exactly one delivery target: `callbackUrl` or `queueName`.
  - Currently rejects non-AP pieces before trigger lookup or lifecycle execution.
- `POST /webhook/:piece`
  - Receives provider webhooks and fan-outs matched events asynchronously.
  - Currently rejects non-AP pieces and handles Slack URL verification directly in the route.
- Worker `queue()` entrypoint
  - Accepts `{ pieceName, payload }` and replays the payload through `dispatchWebhook(...)`.
  - Also currently limited to AP pieces.

Important schema mismatch with standard AP interfaces:

- AP trigger types expect strategy-specific hook contexts with `store`, `webhookUrl`, `payload`, `server`, `files`, and `setSchedule`.
- freepieces native trigger types only expose `props`, `lastPollMs`, `env`, and auth.
- freepieces AP shim contexts do not currently implement the full AP hook surface, so even AP pieces are only partially standardized on triggers.

### Configuration Examples

```toml
[[queues.producers]]
queue = "slack-new-message"
binding = "QUEUE_SLACK_NEW_MESSAGE"
```

This existing queue binding pattern should remain the async delivery mechanism after trigger unification, because it already matches the current fan-out architecture and Cloudflare Workers best practices.

### Technical Requirements

- Replace piece-kind gating with **trigger capability gating**.
- Add a framework-level trigger abstraction that can represent at least:
  - `POLLING`
  - `WEBHOOK`
  - `APP_WEBHOOK`
- Provide a **real trigger context adapter** for both native and AP pieces, including:
  - persistent `store`
  - `webhookUrl`
  - `payload`
  - `server`
  - `files`
  - lifecycle hook execution (`onEnable`, `onDisable`, and when applicable handshake/renew support)
- Keep existing Gmail/native polling behavior working during migration.
- Update every user-facing contract touched by the change:
  - worker routes/helpers
  - SDK/client types/examples
  - README/docs
  - tests
- Preserve Cloudflare delivery behavior:
  - fast provider responses
  - `waitUntil()` for post-response work
  - Queue delivery for async consumers

## Recommended Approach

Unify the trigger runtime around an **AP-shaped trigger contract**, but do it by introducing a **normalized internal trigger adapter layer** instead of trying to erase the native piece model in one jump.

The recommended design is:

1. **Keep native actions/auth as they are for now** to limit risk.
2. **Expand native trigger definitions to an AP-compatible superset**:
   - add strategy support beyond `POLLING`
   - add optional lifecycle hooks and test metadata
   - add a `createTrigger`/`TriggerStrategy` builder in the framework/compat surface so native and ported pieces can author triggers using the same mental model as Activepieces.
3. **Introduce a unified trigger execution layer** that converts both native and AP triggers into one internal shape for:
   - direct `/trigger` execution
   - `/subscriptions/:piece/:trigger`
   - inbound `/webhook/:piece`
   - Worker `queue()` replay
4. **Back trigger state with a real store abstraction** (KV-backed, owner-scoped, piece/trigger-scoped) so AP-style polling and webhook lifecycle hooks can persist state consistently.
5. **Decide subscription eligibility from trigger strategy, not piece kind**:
   - webhook-like strategies (`WEBHOOK`, `APP_WEBHOOK`) can be subscribed
   - polling strategies stay direct-execution/scheduler-driven unless a separate scheduling feature is added later.
6. **Preserve Gmail’s current polling contract as a backward-compatible adapter** while migrating the framework so Gmail keeps working during the refactor.

Why this is the best fit for this repository:

- It matches the user’s goal of “no differences” at the trigger API layer without forcing an immediate rewrite of the entire native piece/action/auth system.
- It solves the real root cause (split trigger abstractions and partial AP lifecycle support), not just the visible AP-only route check.
- It leverages existing strategy-driven UI/docs structure and existing Cloudflare queue fan-out patterns.
- It keeps the migration surface manageable because only Gmail currently uses native triggers.

The non-recommended alternative is to immediately coerce every native piece into a fake AP piece and run one monolithic AP runtime. That would increase risk across auth resolution, action execution, secret derivation, and admin metadata without first solving the missing trigger-store/lifecycle pieces.

## Implementation Guidance

- **Objectives**: remove AP-only trigger gating, expose one trigger authoring model, provide real lifecycle/store support, and keep Gmail/native polling backward compatible while enabling future native webhook/app-webhook triggers.
- **Key Tasks**: extend trigger types/builders, add normalized trigger adapters/context builders, refactor webhook/subscription routes and queue replay, add trigger-state persistence, update SDK/docs/examples/tests, and add native trigger subscription coverage.
- **Dependencies**: `TOKEN_STORE` KV access for persistent trigger state, existing runtime auth helpers, `PUBLIC_URL` for webhook URL construction, existing queue binding resolution, and the current validation commands in `package.json`.
- **Success Criteria**: native and AP triggers share one framework-level trigger shape, subscription/webhook routes are gated by strategy rather than piece kind, lifecycle hooks and persistent trigger state are available where required, Gmail polling continues to work, and docs/examples/tests all describe the new unified behavior consistently.