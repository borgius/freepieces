---
applyTo: ".copilot-tracking/changes/20260522-per-user-action-trigger-toggles-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Per-User Action/Trigger Toggles

## Overview

Add per-user action and trigger enable/disable controls in the admin piece UI, default everything to enabled, expose only enabled actions through MCP for the effective user, and return 404 when disabled actions or triggers are invoked through runtime paths.

## Objectives

- Store per-user, per-piece tool state with default-enabled semantics and no new infrastructure bindings
- Extend the admin API/UI so the current signed-in admin user can view and toggle action/trigger state from piece rows
- Filter MCP discovery to enabled actions only and block disabled action calls consistently
- Return 404 for disabled direct action/trigger execution and suppress disabled trigger delivery in webhook and polling paths
- Keep docs, tests, and validation in sync with the new behavior

## Research Summary

### Project Files

- `src/admin/components/ItemSection.tsx` - current action/trigger row UI and the required checkbox insertion point
- `src/admin/components/PieceCard.tsx` - piece detail sections that feed the per-item rows
- `src/routes/admin-api.ts` - current admin identity, piece metadata, run proxy, and subscription routes
- `src/routes/mcp-api.ts` - current action-only MCP discovery and tool invocation logic
- `src/routes/runtime-api.ts` - direct `/run` and `/trigger` execution paths that need 404 gates
- `src/routes/webhook-api.ts` - trigger subscription create/list/delete behavior
- `src/lib/webhook.ts` - webhook fan-out path that must respect disabled triggers
- `src/lib/polling.ts` - scheduled polling path that must respect disabled triggers
- `README.md` and `docs/*.mdx` - user-facing contracts that currently imply all actions are always available

### External References

- #file:../research/20260522-per-user-action-trigger-toggles-research.md - verified repo-specific findings, storage design, enforcement points, and sync surfaces
- #fetch:https://modelcontextprotocol.io/specification/latest/server/tools - MCP tools discovery/call contract and unknown-tool behavior
- #fetch:https://modelcontextprotocol.io/specification/latest/basic/transports - Streamable HTTP behavior and the transport-vs-protocol 404 tradeoff

### Standards References

- #file:../../AGENTS.md - sync worker/runtime, Linux shims, docs, examples, and tests for any public behavior change
- #file:../../package.json - required validation commands: `npm test`, `npm run check`, and `npm run build`

## Implementation Checklist

### [ ] Phase 1: Shared State and Admin Contracts

- [ ] Task 1.1: Create a shared per-user tool-state helper
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 11-29)

- [ ] Task 1.2: Extend admin identity and piece metadata responses
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 31-50)

- [ ] Task 1.3: Add an admin endpoint for per-item toggles
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 52-69)

### [ ] Phase 2: Admin UI Wiring

- [ ] Task 2.1: Thread current user scope through the admin app
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 73-90)

- [ ] Task 2.2: Refactor item rows and add the corner checkbox
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 92-110)

- [ ] Task 2.3: Wire enabled state through piece-card sections and MCP copy
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 112-131)

### [ ] Phase 3: Runtime, MCP, and Background Enforcement

- [ ] Task 3.1: Gate action discovery and action execution
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 135-156)

- [ ] Task 3.2: Gate trigger execution, subscription creation, and background delivery
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 158-181)

### [ ] Phase 4: Sync Surfaces, Tests, and Validation

- [ ] Task 4.1: Update docs and affected examples
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 185-207)

- [ ] Task 4.2: Add regression coverage and run full validation
  - Details: .copilot-tracking/details/20260522-per-user-action-trigger-toggles-details.md (Lines 209-230)

## Dependencies

- `TOKEN_STORE` KV access shared across Worker and Linux mode
- Existing admin session user identity in `src/routes/admin-api.ts`
- Shared piece/action/trigger metadata from `src/framework/registry.ts`
- MCP routes in `src/routes/mcp-api.ts`
- Runtime trigger delivery paths in `src/lib/webhook.ts` and `src/lib/polling.ts`

## Success Criteria

- Current signed-in admin users can toggle individual actions and triggers from piece rows
- Missing persisted state keeps all actions and triggers enabled by default
- Only enabled actions are returned through MCP discovery for the effective user
- Disabled direct action/trigger invocations return 404
- Disabled triggers no longer deliver through webhook fan-out or scheduled polling, while subscription deletion still works
- Docs, examples, and tests are updated in the same change
- `npm test`, `npm run check`, and `npm run build` pass before completion
