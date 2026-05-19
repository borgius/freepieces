# Changes: Unify Trigger Support Across AP and Native Pieces

**Date**: 2026-05-19

## Summary

Removes the AP-only gating from webhook/subscription trigger flows by unifying trigger execution around capability and strategy. Adds framework/runtime pieces for native and AP triggers to share one lifecycle model, one context shape, and one documented public contract.

## Files Changed

<!-- Updated continuously as implementation proceeds -->

### Phase 1: Unify trigger abstractions

- [ ] `src/framework/types.ts` — extend `PieceTrigger` to support `POLLING`, `WEBHOOK`, `APP_WEBHOOK` strategies + optional lifecycle hooks; add `TriggerStore` interface and `TriggerStrategy` type; extend `PieceTriggerContext` with optional `store` and `webhookUrl`
- [ ] `src/compat/activepieces.ts` — add `createTrigger` builder and `TriggerStrategy` constants for AP-compatible trigger authoring
- [ ] `src/framework/index.ts` — export `createTrigger`, `TriggerStrategy`, `TriggerStore`
- [ ] `src/framework/registry.ts` — add `isTriggerWebhookCapable(pieceName, triggerName)` helper; normalize trigger metadata for both piece kinds

### Phase 2: Generalize webhook subscriptions and queued fan-out

- [ ] `src/lib/ap-context.ts` — add KV-backed `store` to trigger contexts; add `buildNativeTriggerContext` for native webhook triggers
- [ ] `src/routes/webhook-api.ts` — replace `stored.kind !== 'ap'` checks with capability-based trigger gating; add `onEnable`/`onDisable` lifecycle calls
- [ ] `src/lib/webhook.ts` — update `dispatchWebhook` to support both native and AP pieces
- [ ] `src/worker/create-worker.ts` — remove AP-only guard in queue handler
- [ ] `src/routes/runtime-api.ts` — use unified trigger context for direct trigger execution
- [ ] `src/worker.test.ts` — add native trigger subscription/webhook/queue coverage

### Phase 3: Sync public contracts

- [ ] `docs/triggers.mdx` — update to describe unified trigger model
- [ ] `docs/pieces.mdx` — remove AP-only subscription description
- [ ] `README.md` — update trigger/subscription story
