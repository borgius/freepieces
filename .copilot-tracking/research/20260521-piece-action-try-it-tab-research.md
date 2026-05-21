<!-- markdownlint-disable-file -->

# Research: Piece Action "Try it" Tab

**Date**: 2026-05-21  
**Task**: Add a "Try it" tab to piece action popups so users can supply params, select a user, call the action, and see the response — similar to OpenAPI's "Try it" feature.

---

## 1. Existing Dialog Structure

### File: `src/admin/components/ItemSection.tsx`

**Lines 1–32**: Imports — uses Chakra UI `Tabs`, `DialogRoot`, `DialogContent`, etc., and imports `ActionUsageTab`, `ItemMcpTab`, `PropTable`, `TriggerUsageTab` from `./ItemUsage`.

**Lines 33–69** (`ItemRowProps` interface + `ItemRow` component):
- Props: `pieceName`, `name`, `displayName`, `description`, `props`, `accentColor`, `badge`, `badgePalette`, `kind`, `triggerType`
- Missing for "Try it": `pieceAuth` (to detect OAuth2 vs apiKey) and `pieceSupportsUsers` (to show/hide user selector)

**Lines 115–158** (Dialog body): `Tabs.Root` with three tabs: `params`, `usage`, `mcp`. The "Try it" tab will be added as `tryit` (fourth tab).

**Lines 170–182** (`SectionProps`): Interface for `CollapsibleSection`. Needs `pieceAuth` and `pieceSupportsUsers` added.

**Lines 183–293** (`CollapsibleSection`): Iterates items and renders `ItemRow`. Needs to pass `pieceAuth`/`pieceSupportsUsers` through.

**Lines 294–296**: Exports `CollapsibleSection`.

---

## 2. ItemUsage Component

### File: `src/admin/components/ItemUsage.tsx`

**Lines 1–12**: Imports — Chakra UI (Badge, Box, ClipboardRoot, etc.), lucide-react (Copy, Link2), PropDef type.

**Lines 41–56** (`baseUrl()`): Returns `window.location.origin` for code snippet generation.

**Lines 117–148** (`CodeBlock`): Reusable labeled code block with copy button.

**Lines 306–325** (`ActionUsageTab`): Displays curl and fetch code snippets for an action.

**Lines 570–635** (`PropTable`): Renders a table showing prop names, types, required status, and descriptions.

**Lines 637–last**: `ItemMcpTab` — renders MCP config snippets.

**Approach**: Create a new file `src/admin/components/ItemTryIt.tsx` for the `ActionTryItTab` rather than adding to the already large `ItemUsage.tsx`.

---

## 3. PropDef Types (from `src/admin/lib/api.ts`, lines 8–14)

```typescript
export interface PropDef {
  type: string;
  displayName: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
}
```

Type strings from `ItemUsage.tsx` `PROP_TYPE_PALETTE` (lines 17–34):
- `SHORT_TEXT`, `LONG_TEXT` → text inputs
- `NUMBER` → number input
- `CHECKBOX` → checkbox
- `SELECT`, `STATIC_SELECT` → text input with note (no options array in PropDef)
- `MULTI_SELECT`, `STATIC_MULTI_SELECT` → text input (comma-separated) with note
- `OAUTH_DYNAMIC_SELECT`, `DYNAMIC` → text input with note (requires API call to resolve)
- `OBJECT`, `JSON` → textarea (expect JSON object)
- `ARRAY` → textarea (expect JSON array)
- `FILE` → skip with note (not supported in browser Try it)
- `DATE_TIME` → datetime-local input

---

## 4. Admin API: Piece Users Endpoint

### File: `src/admin/lib/api.ts`

**Lines 130–138** (`listPieceUsers()`): 
```typescript
export async function listPieceUsers(name: string): Promise<PieceUser[]> {
  const response = await apiFetch<{ users: PieceUser[] }>(
    `/admin/api/pieces/${encodeURIComponent(name)}/users`
  );
  return response.users;
}
```

**Lines 76–83** (`PieceUser` interface):
```typescript
export interface PieceUser {
  userId: string;
  displayName: string;
}
```

**Lines 85–98** (`PieceInfo`):
```typescript
export interface PieceInfo {
  name: string;
  displayName: string;
  description: string | null;
  version: string;
  auth: PieceAuth;
  mcpEndpoint: string;
  actions: PieceAction[];
  triggers: PieceTrigger[];
  secrets: SecretGroup[];
  supportsUsers: boolean;  // ← true for OAuth2 pieces
  hasAutoUserId: boolean;
  enabled: boolean;
}
```

`PieceAuth` is `PieceAuthMode | PieceAuthMode[] | undefined` where `PieceAuthMode.type` is `'oauth2' | 'OAUTH2' | 'apiKey' | 'SECRET_TEXT' | 'CUSTOM_AUTH' | 'BASIC_AUTH' | 'none'`.

---

## 5. Runtime API: Action Execution

### File: `src/routes/runtime-api.ts`

**Lines 24–95** (`runtimeApi.all('/run/:piece/:action', ...)`):
- Reads `userId`, `pieceToken`, `pieceAuthProps` from `c.var.credentials`
- Parses `props` from JSON body
- For **native** pieces: calls `resolveNativeRuntimeAuth` then `action.run({ auth, props, env, refreshAuth })`
- For **AP** pieces: calls `resolveApRuntimeAuth` then `buildApContext` then `action.run(apCtx)`
- Returns `{ ok: true, result }` or `{ ok: false, error: 'Action execution failed' }` with 500

**Key imports in runtime-api.ts** (lines 1–15):
```typescript
import { getPiece, getTrigger } from '../framework/registry';
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth, forceRefreshNativeAuth } from '../lib/auth-resolve';
import { buildApContext } from '../lib/ap-context';
```

---

## 6. Admin API: Proxy Endpoint to Add

### File: `src/routes/admin-api.ts`

**Current structure**: Already imports `getPiece`, `getTrigger` from registry. Needs the auth-resolve and ap-context imports for the new endpoint.

**New endpoint pattern** (`POST /admin/api/run/:piece/:action`):
- Admin session protected (auto due to existing middleware at line ~140)
- Request body: `{ userId?: string, pieceToken?: string, props?: Record<string, unknown> }`
- Validate piece and action exist
- Resolve auth using the same `resolveNativeRuntimeAuth` / `resolveApRuntimeAuth` logic
- Run the action
- Return `{ ok: true, result }` or `{ ok: false, error: string }`

**Why not use `waitUntil`?**: This is a synchronous request-response — the admin waits for the result, so no `waitUntil` needed.

**Security**: Admin session cookie protects this endpoint. Props/userId/pieceToken come from the authenticated admin, not from a public caller.

---

## 7. Admin API Client: New Function

### File: `src/admin/lib/api.ts`

New function at the end of the file:
```typescript
export async function runActionAsAdmin(
  pieceName: string,
  actionName: string,
  params: {
    userId?: string;
    pieceToken?: string;
    props?: Record<string, unknown>;
  }
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  return apiFetch(`/admin/api/run/${encodeURIComponent(pieceName)}/${encodeURIComponent(actionName)}`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
```

---

## 8. PieceCard.tsx: Passing Auth Metadata

### File: `src/admin/components/PieceCard.tsx`

**Lines 520–528** (CollapsibleSection for actions):
```tsx
<CollapsibleSection
  title="Actions"
  count={piece.actions.length}
  accentColor="blue.400"
  icon={Zap}
  pieceName={piece.name}
  items={piece.actions}
  kind="action"
/>
```

Needs to add: `pieceAuth={piece.auth}` and `pieceSupportsUsers={piece.supportsUsers}`.

**Lines 530–539** (CollapsibleSection for triggers): Triggers don't need "Try it" so no auth props needed (or pass as undefined).

---

## 9. Component Architecture for "Try it" Tab

### New file: `src/admin/components/ItemTryIt.tsx`

**Props**:
```typescript
interface ActionTryItTabProps {
  pieceName: string;
  actionName: string;
  props: Record<string, PropDef> | null;
  pieceAuth: PieceAuth;
  pieceSupportsUsers: boolean;
}
```

**UI sections**:
1. **Auth section** (conditional):
   - OAuth2 pieces (`supportsUsers`): `<select>` populated from `listPieceUsers(pieceName)`. Loads on mount.
   - apiKey / CUSTOM_AUTH / BASIC_AUTH: text input for `pieceToken`
   - No auth: nothing

2. **Params section**: one input per prop entry, using type-appropriate input:
   - `SHORT_TEXT` → `<input type="text">`
   - `LONG_TEXT` / `JSON` / `OBJECT` / `ARRAY` → `<textarea>`
   - `NUMBER` → `<input type="number">`
   - `CHECKBOX` → toggle/checkbox
   - `DATE_TIME` → `<input type="datetime-local">`
   - `SELECT`, `STATIC_SELECT` → `<input type="text">` + helper note
   - `MULTI_SELECT`, `STATIC_MULTI_SELECT` → `<input type="text">` + "(comma-separated)" note
   - `OAUTH_DYNAMIC_SELECT`, `DYNAMIC` → `<input type="text">` + "dynamic (enter value manually)" note
   - `FILE` → disabled with note "File upload not supported in Try it"

3. **Run button**: triggers `runActionAsAdmin()`

4. **Response section**: 
   - Loading state (spinner)
   - Success: pretty-printed JSON in a `<pre>` block (reuse `CodeBlock` style)
   - Error: red error message

**State**: `formValues: Record<string, string>`, `userId: string`, `pieceToken: string`, `running: boolean`, `result: unknown | null`, `error: string`.

**Value parsing before submit**:
- `NUMBER` → `parseFloat(val)` or `parseInt(val, 10)`
- `CHECKBOX` → `val === 'true'` or boolean from checkbox state
- `JSON` / `OBJECT` / `ARRAY` → `JSON.parse(val)` with error catch
- Everything else → raw string (or undefined if empty)

---

## 10. ItemSection.tsx Changes

**`ItemRowProps` additions**:
```typescript
pieceAuth?: PieceAuth;
pieceSupportsUsers?: boolean;
```

**Dialog Tabs.Root changes**: Add fourth tab (only for `kind === 'action'`):
```tsx
{kind === 'action' && (
  <Tabs.Trigger value="tryit">Try it</Tabs.Trigger>
)}
...
{kind === 'action' && (
  <Tabs.Content value="tryit">
    <ActionTryItTab
      pieceName={pieceName}
      actionName={name}
      props={props}
      pieceAuth={pieceAuth}
      pieceSupportsUsers={pieceSupportsUsers ?? false}
    />
  </Tabs.Content>
)}
```

**`SectionProps` additions**:
```typescript
pieceAuth?: PieceAuth;
pieceSupportsUsers?: boolean;
```

**`CollapsibleSection` changes**: Pass `pieceAuth` and `pieceSupportsUsers` to each `ItemRow`.

---

## 11. Validation Checklist

- `npm test` — no regressions in existing tests
- `npm run check` — TypeScript type-check passes
- `npm run build` — build succeeds (required per AGENTS.md)
- UI: "Try it" tab only appears for actions (not triggers)
- UI: User selector appears only for OAuth2 pieces
- UI: pieceToken input appears for apiKey/CUSTOM_AUTH pieces
- UI: Form correctly parses NUMBER, CHECKBOX, JSON prop types before submit
- Backend: `/admin/api/run/:piece/:action` returns 404 when piece/action not found
- Backend: `/admin/api/run/:piece/:action` executes native and AP pieces
- Backend: Response is `{ ok: true, result }` on success, `{ ok: false, error }` on failure
