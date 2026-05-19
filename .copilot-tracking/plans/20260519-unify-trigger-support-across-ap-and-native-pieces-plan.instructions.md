---
applyTo: ".copilot-tracking/changes/20260519-unify-trigger-support-across-ap-and-native-pieces-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Unify Trigger Support Across AP and Native Pieces

## Overview

Plan the work needed to make trigger behavior strategy-driven instead of AP-only, while aligning native trigger authoring with standard Activepieces trigger interfaces.

## Objectives

- Remove the AP-only gating from webhook/subscription trigger flows by unifying trigger execution around capability and strategy.
- Add the framework/runtime pieces needed for native and AP triggers to share one lifecycle model, one context shape, and one documented public contract.

## Research Summary

### Project Files

- `src/routes/webhook-api.ts` - current AP-only subscription/webhook gate that blocks native trigger subscriptions.
- `src/lib/webhook.ts` - AP-only dispatch path and queue/callback fan-out logic.
- `src/framework/types.ts` - native vs AP trigger type split and current strategy limitations.
- `src/lib/ap-context.ts` - partial AP trigger shim with no-op store/listener behavior.
- `src/pieces/gmail.ts` - only native trigger-bearing piece today; backward compatibility anchor.
- `src/admin/components/ItemUsage.tsx` - already strategy-driven usage rendering for polling vs subscription flows.

### External References

- #file:../research/20260519-unify-trigger-support-across-ap-and-native-pieces-research.md - verified analysis of the AP/native trigger split, upstream AP trigger expectations, and recommended unification approach.
- #githubRepo:"activepieces/activepieces createTrigger TriggerStrategy onEnable onDisable webhookUrl" - upstream AP trigger lifecycle and context contract reference.
- #fetch:https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/overview.md - official AP trigger structure and strategy model.
- #fetch:https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/polling-trigger.md - official AP polling/state expectations.
- #fetch:https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/webhook-trigger.md - official AP webhook lifecycle expectations.
- #fetch:https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ - Cloudflare guidance for `waitUntil()` and queue-backed async delivery.

### Standards References

- #file:../../AGENTS.md - repo-wide sync requirements, runtime auth contract, and required validation commands.
- #file:../../package.json - canonical validation scripts (`npm test`, `npm run check`).
- #file:../../.agents/skills/workers-best-practices/SKILL.md - current Cloudflare Workers best practices for async/background webhook work.

## Implementation Checklist

### [ ] Phase 1: Unify trigger abstractions

- [ ] Task 1.1: Expand trigger types and builders to AP-compatible strategies
  - Details: `.copilot-tracking/details/20260519-unify-trigger-support-across-ap-and-native-pieces-details.md` (Lines 11-30)

- [ ] Task 1.2: Build a unified trigger context and persistent state adapter
  - Details: `.copilot-tracking/details/20260519-unify-trigger-support-across-ap-and-native-pieces-details.md` (Lines 32-54)

### [ ] Phase 2: Generalize webhook subscriptions and queued fan-out

- [ ] Task 2.1: Refactor subscription, webhook, and queue entrypoints to use trigger capability gating
  - Details: `.copilot-tracking/details/20260519-unify-trigger-support-across-ap-and-native-pieces-details.md` (Lines 58-79)

- [ ] Task 2.2: Add targeted tests for native/AP trigger parity and lifecycle behavior
  - Details: `.copilot-tracking/details/20260519-unify-trigger-support-across-ap-and-native-pieces-details.md` (Lines 81-99)

### [ ] Phase 3: Sync public contracts and verify the repository stays coherent

- [ ] Task 3.1: Update SDK, examples, docs, and admin guidance for unified trigger behavior
  - Details: `.copilot-tracking/details/20260519-unify-trigger-support-across-ap-and-native-pieces-details.md` (Lines 103-123)

- [ ] Task 3.2: Validate with repository-standard checks and confirm no stray contract drift remains
  - Details: `.copilot-tracking/details/20260519-unify-trigger-support-across-ap-and-native-pieces-details.md` (Lines 125-142)

## Dependencies

- `TOKEN_STORE` KV binding for owner-scoped trigger state.
- `PUBLIC_URL`/runtime URL helpers for webhook URL generation.
- Existing queue binding resolution and `waitUntil()` delivery model.
- Repository validation scripts: `npm test` and `npm run check`.

## Success Criteria

- Native and AP triggers share one framework-level strategy vocabulary and lifecycle model, and subscriptions are enabled by trigger capability rather than piece kind.
- Gmail/native polling remains backward compatible during migration, and all affected surfaces (runtime, SDK, docs, examples, admin usage, tests) are updated together.