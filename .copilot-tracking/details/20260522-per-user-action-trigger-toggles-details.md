<!-- markdownlint-disable-file -->

# Task Details: Per-User Action/Trigger Toggles

## Research Reference

**Source Research**: #file:../research/20260522-per-user-action-trigger-toggles-research.md

## Phase 1: Shared State and Admin Contracts

### Task 1.1: Create a shared per-user tool-state helper

Create a dedicated helper module under `src/lib/` for per-user, per-piece action/trigger state. Use default-enabled denylist semantics so a missing KV record means every action and trigger remains enabled. Keep the storage shape small and explicit, and back it with `TOKEN_STORE` so Cloudflare and Linux/self-hosted modes share the same persistence behavior.

- **Files**:
  - `src/lib/user-tool-state.ts` - central load/save/check helpers for disabled actions and disabled triggers
  - `src/lib/user-tool-state.test.ts` - focused unit coverage for default-enabled semantics and toggle persistence
  - `src/linux-server.ts` - only if type wiring needs a small import or helper touchpoint for Linux mode
- **Success**:
  - Missing KV state resolves to all actions and triggers enabled
  - One helper surface can answer both `isActionEnabledForUser(...)` and `isTriggerEnabledForUser(...)`
  - The helper reuses `TOKEN_STORE` and does not require new env vars or bindings
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 113-142) - existing persistence patterns and the full enforcement surface
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 255-275) - recommended KV key family and JSON document shape
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 301-352) - denylist rationale and proposed helper API
- **Dependencies**:
  - Existing `TOKEN_STORE` KV binding
  - Current Linux file-backed KV shim in `src/lib/linux-kv.ts`

### Task 1.2: Extend admin identity and piece metadata responses

Update the admin APIs so the SPA receives a stable `userId` alongside `email`, and so the piece list includes per-item `enabled` flags for actions and triggers for the effective user scope. Keep this enrichment admin-only; do not change the public `/pieces` contract unless product scope expands later.

- **Files**:
  - `src/routes/admin-api.ts` - expand `GET /admin/api/me` and enrich `GET /admin/api/pieces`
  - `src/admin/lib/api.ts` - update `getMe()` types and add `enabled` to admin-only `PieceAction` and `PieceTrigger`
  - `src/framework/registry.ts` - only if a small shared mapper is needed while keeping public output unchanged
- **Success**:
  - `GET /admin/api/me` returns both `userId` and `email`
  - `GET /admin/api/pieces` returns `enabled` on each action and trigger for the current user scope
  - Public discovery and SDK types remain unchanged in the first pass
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 24-32) - current admin types, `getMe()`, and pieces response shape
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 204-247) - current admin/public API contracts
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 356-363) - recommended `GET /admin/api/me` and `GET /admin/api/pieces` changes
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 453-457) - implementation objectives for admin-visible state
- **Dependencies**:
  - Task 1.1 helper module
  - Existing admin session state in `src/routes/admin-api.ts`

### Task 1.3: Add an admin endpoint for per-item toggles

Add one admin toggle route that accepts `action` or `trigger`, defaults the user scope to the current session user, and flips the item state without changing the piece-wide enabled flag. Keep the route simple so a future cross-user selector can pass `userId` later without a storage migration.

- **Files**:
  - `src/routes/admin-api.ts` - add `PATCH /admin/api/pieces/:piece/:kind/:name`
  - `src/admin/lib/api.ts` - add a `setPieceItemEnabled(...)` helper
- **Success**:
  - The route accepts `{ enabled: boolean, userId?: string }`
  - `kind` is validated as `action` or `trigger`
  - Toggle writes update the shared per-user tool-state document instead of inventing a second persistence format
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 241-247) - current admin route landscape
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 365-370) - recommended admin toggle route shape
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 459-465) - key implementation tasks for admin toggle flow
- **Dependencies**:
  - Task 1.1 helper module
  - Task 1.2 admin identity response

## Phase 2: Admin UI Wiring

### Task 2.1: Thread current user scope through the admin app

Update the admin SPA to store both `userId` and `email` from `getMe()`, and thread the current user scope into the pieces page so the checkbox state and mutations are anchored to a stable identifier instead of display email.

- **Files**:
  - `src/admin/App.tsx` - store `userId` plus `email` and pass the effective scope down
  - `src/admin/pages/PiecesPage.tsx` - accept the current user scope and keep piece refresh flows in sync after toggles
- **Success**:
  - The SPA no longer relies on `email` as the toggle key
  - Pieces refresh correctly after item enable/disable updates
  - No extra cross-user selector is introduced in the first pass
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 11-18) - current admin app and pieces page wiring
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 77-78) - current `getMe()` limitation on the client
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 293-296) - current-product-scope assumptions and open questions
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 372-380) - recommended admin UI data flow
- **Dependencies**:
  - Task 1.2 admin identity response

### Task 2.2: Refactor item rows and add the corner checkbox

Refactor `ItemRow` so the row is no longer a single button. Preserve the existing detail-dialog affordance while introducing a separate checkbox control in the trailing corner area. Reuse the admin UI checkbox pattern already present elsewhere in the repo, and avoid invalid nested interactive markup.

- **Files**:
  - `src/admin/components/ItemSection.tsx` - split row container vs. detail-open control and render the new enabled checkbox
  - `src/admin/components/AddTriggerForm.tsx` - reference only for checkbox styling/pattern consistency
- **Success**:
  - The row no longer nests a checkbox inside a button
  - Users can toggle an action or trigger without opening the details dialog
  - The trailing corner area cleanly hosts the checkbox while preserving the existing scan/details affordance
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 17-23) - current `ItemRow` structure and existing checkbox precedent
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 97-109) - why the current button structure must be refactored
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 279-281) - technical requirement to avoid nested interactive controls
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 381-385) - recommended UI change in `ItemSection.tsx`
- **Dependencies**:
  - Task 1.2 admin item `enabled` state
  - Task 1.3 toggle route and client helper

### Task 2.3: Wire enabled state through piece-card sections and MCP copy

Thread the per-item `enabled` state through `PieceCard` and related admin components, and update MCP-facing admin copy if needed so it no longer implies that every action is always exposed. Keep trigger-facing admin wording accurate because MCP remains action-only.

- **Files**:
  - `src/admin/components/PieceCard.tsx` - pass enriched action/trigger rows into `CollapsibleSection`
  - `src/admin/components/ItemUsage.tsx` - update MCP tab wording if it mentions all actions unconditionally
  - `src/admin/components/PieceMcpSection.tsx` - update summary copy if it mentions unconditional MCP availability
- **Success**:
  - `CollapsibleSection` and `ItemRow` receive the `enabled` state they need
  - Admin copy clearly reflects that only enabled actions are exposed as MCP tools
  - Trigger UI no longer suggests that triggers are MCP tools
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 20-21) - current MCP copy issue in `ItemUsage.tsx`
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 71-72) - current MCP-related UI/doc surfaces
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 109-109) - trigger/action MCP wording mismatch
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 372-385) - recommended `PieceCard` and UI threading changes
- **Dependencies**:
  - Task 2.1 current user scope in the SPA
  - Task 2.2 row refactor

## Phase 3: Runtime, MCP, and Background Enforcement

### Task 3.1: Gate action discovery and action execution

Enforce the per-user action state everywhere actions can be discovered or executed. That includes direct runtime REST calls, admin run proxies, `GET /mcp/:piece`, MCP `tools/list`, and MCP `tools/call`. Use the shared helper so every surface agrees on whether an action is enabled.

- **Files**:
  - `src/routes/runtime-api.ts` - return 404 for disabled actions on `/run/:piece/:action`
  - `src/routes/admin-api.ts` - gate the admin run proxy if it is scoped to the same current user
  - `src/routes/mcp-api.ts` - filter disabled actions from metadata and discovery, and reject disabled action calls
  - `src/lib/request-auth.ts` - only if a tiny helper is useful to centralize effective-user lookup
- **Success**:
  - Disabled actions disappear from `GET /mcp/:piece` and `tools/list`
  - Disabled actions cannot be executed through REST or MCP
  - Action gating logic is shared instead of duplicated ad hoc per route
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 44-48) - current runtime and MCP execution surfaces
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 132-142) - full action-routing blast radius
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 232-253) - current public/admin API contracts and MCP protocol facts
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 282-284) - MCP applies to actions only today
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 387-395) - recommended action enforcement points
- **Dependencies**:
  - Task 1.1 helper module
  - Task 1.2 admin identity changes if the admin proxy shares the same scope model

### Task 3.2: Gate trigger execution, subscription creation, and background delivery

Apply the same shared state to every trigger path: direct `/trigger`, runtime subscription creation, admin subscription creation, webhook fan-out, queue replay, and scheduled polling. Disabled triggers should go dormant without breaking cleanup; deleting an existing subscription must still work.

- **Files**:
  - `src/routes/runtime-api.ts` - return 404 for disabled direct trigger calls
  - `src/routes/webhook-api.ts` - reject new subscription creation for disabled triggers while preserving delete behavior
  - `src/routes/admin-api.ts` - gate admin-created subscriptions the same way
  - `src/lib/webhook.ts` - skip disabled subscriptions during webhook fan-out and queue replay
  - `src/lib/polling.ts` - skip disabled subscriptions during scheduled polling
  - `src/worker/create-worker.ts` - only if a small shared guard or test wiring change is needed for queue/scheduled entrypoints
- **Success**:
  - Disabled triggers return 404 for direct trigger execution and new subscription creation
  - Existing subscriptions remain stored but do not deliver while disabled
  - Subscription deletion still works even if the trigger is currently disabled
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 40-52) - webhook, polling, and worker entrypoint surfaces
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 132-142) - why `/trigger`-only gating is insufficient
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 285-291) - technical requirements for trigger dormancy and deletion behavior
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 396-403) - recommended trigger enforcement points and deletion nuance
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 453-466) - implementation objectives and key tasks
- **Dependencies**:
  - Task 1.1 helper module
  - Task 1.3 admin toggle route

## Phase 4: Sync Surfaces, Tests, and Validation

### Task 4.1: Update docs and affected examples

Update user-facing docs and any example/client copy that currently promises unconditional MCP action exposure. Keep the first-pass SDK/public discovery contract stable unless product scope expands, but make sure docs describe the new per-user visibility behavior accurately.

- **Files**:
  - `README.md` - revise MCP/tool-availability wording
  - `docs/mcp.mdx` - explain that only enabled actions appear for the effective user
  - `docs/actions.mdx` - document action enable/disable behavior if action execution examples are shown
  - `docs/triggers.mdx` - document trigger disablement effects on direct execution and subscriptions
  - `docs/auth.mdx` - mention the new per-user tool-state storage if admin/token-store docs enumerate stored state
  - `docs/pieces.mdx` - update any piece metadata or admin UI references
  - `src/client/script-client.ts`, `examples/sdk-example.ts`, `examples/slack-example.ts` - only if their copy or examples imply all tools are always available
- **Success**:
  - Docs no longer claim every registered action is always exposed through MCP
  - Action and trigger enable/disable behavior is described consistently
  - Examples remain aligned with the current public API contract
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 57-61) - current doc claims that need revision
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 282-284) - MCP scope remains action-only
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 405-442) - required sync surfaces across docs and examples
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 459-466) - docs/examples update task summary
- **Dependencies**:
  - Phase 3 enforcement behavior settled

### Task 4.2: Add regression coverage and run full validation

Add targeted tests for the new helper, admin metadata/toggle flow, MCP filtering and call rejection, direct action/trigger 404 behavior, and dormant trigger delivery in webhook/polling paths. Then run the required validation commands for this repo.

- **Files**:
  - `src/lib/user-tool-state.test.ts` - unit tests for helper semantics
  - `src/worker/create-worker.test.ts` - MCP listing/calling and runtime route coverage
  - `src/worker.test.ts` - admin APIs, trigger subscription behavior, and route-level enforcement
  - `src/lib/webhook.test.ts` - dormant webhook/subscription delivery behavior
  - `src/sdk/client.test.ts` and `src/sdk/client.retry.test.ts` - only if SDK-facing behavior or documentation examples require updates
- **Success**:
  - Tests cover default-enabled state, disabled action discovery/call rejection, disabled trigger dormancy, and subscription deletion while disabled
  - `npm test` passes
  - `npm run check` passes
  - `npm run build` passes
- **Research References**:
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 62-63) - current relevant test coverage landscape
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 443-449) - recommended test surfaces
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 474-481) - final success criteria and validation expectations
  - #file:../research/20260522-per-user-action-trigger-toggles-research.md (Lines 297-297) - validation command requirement
- **Dependencies**:
  - Phases 1 through 3 complete

## Dependencies

- Existing `TOKEN_STORE` KV binding and Linux file-backed KV compatibility
- Current admin session state in `src/routes/admin-api.ts`
- Runtime request credential handling in `src/lib/request-auth.ts`
- Piece/action/trigger metadata from `src/framework/registry.ts`

## Success Criteria

- Admin piece rows expose a working per-item checkbox without invalid nested-button markup
- Missing per-user tool-state records keep all actions and triggers enabled by default
- MCP discovery and piece metadata expose only enabled actions for the effective user
- Disabled actions and triggers return 404 on direct execution paths
- Disabled triggers stop delivering through webhook fan-out and scheduled polling while remaining deletable
- `README.md`, `docs/`, and any affected examples stay aligned with the new behavior
- `npm test`, `npm run check`, and `npm run build` all pass after implementation
