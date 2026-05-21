---
applyTo: ".copilot-tracking/changes/20260521-piece-action-try-it-tab-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Piece Action "Try it" Tab

## Overview

Add a "Try it" tab to piece action dialogs in the admin panel, allowing users to fill in params, select a connected user (for OAuth2 pieces), call the action live, and see the response.

## Objectives

- Add `POST /admin/api/run/:piece/:action` admin-session-protected proxy endpoint
- Add `runActionAsAdmin()` API client function in the admin lib
- Create `ActionTryItTab` component with type-aware param form + user selector + response display
- Wire "Try it" tab into the existing action dialog (actions only, not triggers)
- Preserve all existing behaviour (Params, Usage, MCP tabs unchanged)

## Research Summary

### Project Files

- `src/admin/components/ItemSection.tsx` — Contains `ItemRow` dialog with 3-tab `Tabs.Root`; needs 4th "Try it" tab for actions
- `src/admin/components/ItemUsage.tsx` — Reusable `CodeBlock`, `PropTable`; new `ItemTryIt.tsx` will co-exist
- `src/admin/lib/api.ts` — Admin API client; add `runActionAsAdmin()` function
- `src/routes/admin-api.ts` — Admin-protected Hono routes; add the run proxy endpoint
- `src/routes/runtime-api.ts` — Action execution pattern to replicate in admin-api
- `src/admin/components/PieceCard.tsx` — Passes `PieceInfo` to `CollapsibleSection`; needs to forward `pieceAuth` and `pieceSupportsUsers`

### External References

- #file:../research/20260521-piece-action-try-it-tab-research.md — Full architecture research with code examples

## Implementation Checklist

### [ ] Phase 1: Backend — Admin Run Proxy Endpoint

- [ ] Task 1.1: Import auth-resolve and ap-context helpers in admin-api.ts

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 13-28)

- [ ] Task 1.2: Add `POST /admin/api/run/:piece/:action` route to admin-api.ts

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 30-75)

### [ ] Phase 2: API Client

- [ ] Task 2.1: Add `runActionAsAdmin()` function to `src/admin/lib/api.ts`

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 77-100)

### [ ] Phase 3: Frontend — ActionTryItTab Component

- [ ] Task 3.1: Create `src/admin/components/ItemTryIt.tsx` with user selector, prop form, run button, and response display

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 102-210)

### [ ] Phase 4: Wire into Dialog

- [ ] Task 4.1: Update `ItemRowProps` and `SectionProps` in `ItemSection.tsx` to accept `pieceAuth` and `pieceSupportsUsers`

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 212-240)

- [ ] Task 4.2: Add "Try it" tab to the `Tabs.Root` dialog in `ItemRow` (actions only)

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 242-270)

- [ ] Task 4.3: Update `CollapsibleSection` to forward `pieceAuth` and `pieceSupportsUsers` to `ItemRow`

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 272-290)

- [ ] Task 4.4: Update `PieceCard.tsx` to pass `pieceAuth` and `pieceSupportsUsers` to the actions `CollapsibleSection`

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 292-310)

### [ ] Phase 5: Validation

- [ ] Task 5.1: Run `npm test`, `npm run check`, `npm run build`

  - Details: .copilot-tracking/details/20260521-piece-action-try-it-tab-details.md (Lines 312-325)

## Dependencies

- Chakra UI v3 (`@chakra-ui/react`) — already in project
- Hono — already in project for admin-api routes
- `resolveNativeRuntimeAuth`, `resolveApRuntimeAuth`, `forceRefreshNativeAuth` from `src/lib/auth-resolve`
- `buildApContext` from `src/lib/ap-context`
- `getPiece` from `src/framework/registry`

## Success Criteria

- "Try it" tab visible only in action dialogs (not trigger dialogs)
- OAuth2 pieces show a populated user selector; apiKey pieces show pieceToken input; no-auth pieces show neither
- Submitting the form calls `POST /admin/api/run/:piece/:action` and displays the response JSON
- All existing tabs (Params, Usage, MCP) and all existing tests continue to pass
- TypeScript and build checks pass
