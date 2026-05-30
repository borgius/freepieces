<!-- markdownlint-disable-file -->

# Changes Log: Per-User Action/Trigger Toggles

## Summary

- Implement per-user action and trigger enable/disable state backed by `TOKEN_STORE`
- Expose current admin `userId` to the SPA and enrich admin piece metadata with per-item enabled state
- Add admin toggle mutations, wire row-level checkboxes, and keep MCP wording accurate
- Enforce disabled state across runtime, MCP, subscriptions, webhook fan-out, and polling
- Update docs and tests, then run full validation

## Implemented Changes

- Added `src/lib/user-tool-state.ts` with a shared per-user, per-piece denylist helper for disabled actions and triggers.
- Added `src/lib/user-tool-state.test.ts` to cover default-enabled semantics, persistence, cleanup, and normalization.
- Extended `GET /admin/api/me` to return both `userId` and `email`.
- Enriched `GET /admin/api/pieces` so each action and trigger includes an `enabled` flag for the current admin user.
- Added `PATCH /admin/api/pieces/:piece/:kind/:name` to toggle per-item enabled state.
- Wired the admin app to carry `currentUserId` through `App`, `PiecesPage`, `PieceCard`, and `ItemSection`.
- Refactored item rows so the details affordance and enable checkbox are separate controls.
- Removed the misleading MCP tab from trigger dialogs and updated MCP copy to describe enabled action filtering.
- Enforced per-user disablement in:
	- `POST /run/:piece/:action`
	- `POST /trigger/:piece/:trigger`
	- `POST /subscriptions/:piece/:trigger`
	- `POST /admin/api/run/:piece/:action`
	- `POST /admin/api/subscriptions/:piece/:trigger`
	- `GET /mcp/:piece`
	- MCP `tools/list`
	- MCP `tools/call`
	- webhook fan-out in `src/lib/webhook.ts`
	- scheduled polling in `src/lib/polling.ts`
- Updated README and runtime docs to explain per-user enablement, MCP filtering, and dormant disabled subscriptions.
- Added regression coverage in:
	- `src/worker/create-worker.test.ts`
	- `src/worker.admin-toggles.test.ts`
	- `src/lib/webhook.test.ts`
	- `src/lib/polling.test.ts`

## Checklist

### Phase 1: Shared State and Admin Contracts

- [x] Task 1.1: Create a shared per-user tool-state helper
- [x] Task 1.2: Extend admin identity and piece metadata responses
- [x] Task 1.3: Add an admin endpoint for per-item toggles

### Phase 2: Admin UI Wiring

- [x] Task 2.1: Thread current user scope through the admin app
- [x] Task 2.2: Refactor item rows and add the corner checkbox
- [x] Task 2.3: Wire enabled state through piece-card sections and MCP copy

### Phase 3: Runtime, MCP, and Background Enforcement

- [x] Task 3.1: Gate action discovery and action execution
- [x] Task 3.2: Gate trigger execution, subscription creation, and background delivery

### Phase 4: Sync Surfaces, Tests, and Validation

- [x] Task 4.1: Update docs and affected examples
- [x] Task 4.2: Add regression coverage and run full validation

## Notes

- Created on 2026-05-24.
- Follow `AGENTS.md` sync requirements across runtime, admin UI, docs, and tests.

## Validation

- `npm test` ✅
- `npm run check` ✅
- `npm run build` ✅
