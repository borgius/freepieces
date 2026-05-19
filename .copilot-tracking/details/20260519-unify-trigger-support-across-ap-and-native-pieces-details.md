<!-- markdownlint-disable-file -->

# Task Details: Unify Trigger Support Across AP and Native Pieces

## Research Reference

**Source Research**: #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md

## Phase 1: Unify trigger abstractions

### Task 1.1: Expand trigger types and builders to AP-compatible strategies

Introduce a framework-level trigger abstraction that lets native pieces declare the same strategy-level concepts that Activepieces triggers already use. Keep the existing native action/auth model intact, but stop limiting native triggers to `type: 'POLLING'` only.

- **Files**:
  - `src/framework/types.ts` - extend native trigger types so they can represent `POLLING`, `WEBHOOK`, and `APP_WEBHOOK`, plus optional lifecycle hooks and test metadata.
  - `src/framework/index.ts` and `src/framework/piece.ts` - export the new trigger builder and any shared strategy enums/constants.
  - `src/compat/activepieces.ts` - add `createTrigger` and `TriggerStrategy` compatibility exports so non-AP authored pieces can use the standard AP trigger authoring surface.
  - `src/framework/registry.ts` - normalize trigger metadata and lookup behavior so list/lookup paths treat native and AP trigger strategies consistently.
- **Success**:
  - Native pieces can declare webhook-capable triggers without being wrapped as AP pieces.
  - Existing Gmail trigger definitions continue to compile and remain mechanically migratable.
  - `/pieces` metadata and admin usage rendering see one trigger strategy vocabulary for both piece models.
- **Research References**:
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 13-20) - current native/AP trigger type split and missing native trigger builder.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 46-60) - upstream Activepieces strategy and lifecycle expectations.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 83-89) - project-level compatibility gaps to close.
- **Dependencies**:
  - Preserve the current native auth/action model to reduce blast radius.
  - Match names and semantics from the installed `@activepieces/pieces-framework` package.

### Task 1.2: Build a unified trigger context and persistent state adapter

Replace the current split between native `PieceTriggerContext` and the partial AP shim with a normalized trigger execution layer that can supply AP-shaped context fields to both native and AP triggers. The state adapter should be backed by KV and keep a compatibility bridge for legacy `lastPollMs`-driven polling.

- **Files**:
  - `src/lib/ap-context.ts` - refactor or split into shared trigger-context builders instead of a partial AP-only shim.
  - `src/framework/types.ts` - define any shared trigger context types and compatibility fields.
  - `src/routes/runtime-api.ts` - route direct trigger execution through the normalized trigger adapter for both native and AP pieces.
  - `src/lib/auth-resolve.ts` - preserve native/AP auth resolution in the unified trigger executor.
  - `src/lib/env.ts` or a new helper module - add any reusable trigger-state key helpers needed for KV-backed store access.
- **Success**:
  - AP triggers receive a real `store` and usable `webhookUrl`-style context instead of no-op placeholders.
  - Native triggers can opt into the same context contract while Gmail keeps working with backward-compatible polling semantics.
  - Direct `/trigger` execution stops depending on piece kind for context shape selection.
- **Research References**:
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 14-18) - current direct-trigger split and AP shim limitations.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 42-47) - verified upstream AP context/store/webhook lifecycle expectations.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 159-177) - current route/schema mismatch with standard AP interfaces.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 216-234) - recommended adapter + KV-backed state approach.
- **Dependencies**:
  - `TOKEN_STORE` KV binding availability.
  - `PUBLIC_URL`/runtime URL helpers for webhook URL construction.
  - Task 1.1 completion.

## Phase 2: Generalize webhook subscriptions and queued fan-out

### Task 2.1: Refactor subscription, webhook, and queue entrypoints to use trigger capability gating

Remove the AP-only route checks and rework subscription eligibility around trigger strategy/capability. Webhook-capable native triggers should use the same subscription creation, inbound webhook, and queue replay paths as AP triggers.

- **Files**:
  - `src/routes/webhook-api.ts` - replace piece-kind gating with strategy-aware trigger validation and lifecycle handling.
  - `src/lib/webhook.ts` - make dispatch work with normalized trigger adapters instead of `ApPiece` only.
  - `src/worker/create-worker.ts` - let queued raw payload replay dispatch webhook-capable native pieces too.
  - `src/framework/registry.ts` - expose enough normalized trigger metadata for route-layer capability checks.
- **Success**:
  - `/subscriptions/:piece/:trigger` works for any piece whose trigger strategy is webhook-capable.
  - `/webhook/:piece` and Worker `queue()` replay can dispatch both native and AP triggers.
  - Subscription creation/deletion can execute `onEnable`/`onDisable` through the unified trigger adapter.
  - Existing queue delivery (`callbackUrl` vs `queueName`) remains unchanged from the consumer’s perspective.
- **Research References**:
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 9-12) - hard route and dispatch coupling to AP pieces.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 27-34) - queue replay and test coverage gaps.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 95-100) - current filter-only AP webhook pattern.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 191-212) - technical requirements for capability-based gating and Cloudflare-safe delivery.
- **Dependencies**:
  - Phase 1 normalized trigger metadata and context builder.
  - Existing runtime auth ownership model for subscriptions.

### Task 2.2: Add targeted tests for native/AP trigger parity and lifecycle behavior

Cover the new unified trigger behavior with focused unit tests instead of relying on manual route checks. Include at least one native-trigger subscription path and one lifecycle/state assertion so the regression surface is guarded.

- **Files**:
  - `src/worker.test.ts` - add native subscription/webhook/queue coverage and keep existing Slack coverage passing.
  - `src/framework/registry.memo.test.ts` and/or a new trigger-adapter test file - verify normalized trigger lookup/metadata behavior.
  - `src/pieces/gmail.test.ts` or a dedicated trigger-context test - cover the Gmail compatibility bridge if `lastPollMs` remains supported during migration.
- **Success**:
  - Tests fail if subscriptions regress back to AP-only behavior.
  - Tests cover lifecycle hooks or persistent trigger-state behavior, not just happy-path JSON responses.
  - Existing queue-delivery tests continue to validate the unchanged payload shape.
- **Research References**:
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 31-34) - current missing coverage.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 103-104) - Gmail is the only native trigger migration surface.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 247-250) - success criteria require parity plus backward compatibility.
- **Dependencies**:
  - Task 2.1 completion.
  - Existing Vitest setup in `package.json`.

## Phase 3: Sync public contracts and verify the repository stays coherent

### Task 3.1: Update SDK, examples, docs, and admin guidance for unified trigger behavior

Any public behavior change around trigger strategies, subscription eligibility, or lifecycle semantics must be reflected across the SDK, docs, and examples in the same change. Preserve the split between polling and webhook usage, but stop describing subscriptions as AP-only once the runtime is unified.

- **Files**:
  - `src/sdk/client.ts` and `src/sdk/types.ts` - update any trigger/subscription request or response types that change.
  - `examples/sdk-example.ts` and any trigger examples - keep runtime calling conventions aligned with the worker contract.
  - `src/admin/components/ItemUsage.tsx` - ensure usage text describes webhook-capable triggers generically, not as AP-only behavior.
  - `README.md` - update the route behavior and trigger/support story.
  - `docs/triggers.mdx`, `docs/pooling.mdx`, `docs/pieces.mdx`, and related docs - explain the new unified trigger model and Gmail/native migration behavior.
- **Success**:
  - No user-facing doc still claims subscriptions are AP-only if the runtime no longer behaves that way.
  - SDK/examples demonstrate the same trigger contract the worker enforces.
  - Admin usage text remains strategy-driven and no longer implies a hidden AP/native distinction.
- **Research References**:
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 25-32) - existing user-facing surfaces already tied to current behavior.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 101-102) - admin usage is already strategy-driven and should stay that way.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 204-208) - all touched public contracts must be updated together.
- **Dependencies**:
  - `AGENTS.md` sync requirement across worker, SDK, docs, examples, and tests.
  - Phase 2 runtime behavior finalized.

### Task 3.2: Validate with repository-standard checks and confirm no stray contract drift remains

Run the required repository checks and use them as the final acceptance gate for the unified trigger work. This task also includes a final audit to confirm no AP-only assumptions remain in runtime docs or tests.

- **Files**:
  - `package.json` - validation scripts reference.
  - Any files touched in Phases 1-3 that still fail tests or type-checking.
- **Success**:
  - `npm test` passes.
  - `npm run check` passes.
  - Trigger behavior, docs, SDK examples, and tests all tell the same story.
- **Research References**:
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 64-65) - repository conventions require synced public surfaces and standard validation.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 209-212) - preserve Cloudflare-safe delivery behavior while validating the new runtime.
  - #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md (Lines 247-250) - final success criteria.
- **Dependencies**:
  - Phase 3 implementation complete.
  - Repository scripts from `package.json`.

## Dependencies

- `TOKEN_STORE` KV binding and current auth helpers for owner-scoped trigger state.
- `PUBLIC_URL`/environment helpers for webhook URL construction.
- Existing Cloudflare Queue binding resolution and `waitUntil()` delivery model.
- Repository validation commands: `npm test` and `npm run check`.

## Success Criteria

- Native and AP triggers share one framework-level strategy vocabulary and lifecycle model.
- Webhook subscriptions are enabled by trigger capability, not by piece kind.
- A real trigger-state/lifecycle context exists for unified trigger execution.
- Gmail/native polling remains backward compatible during the migration.
- Docs, SDK, examples, admin usage text, and tests are all updated in the same change.