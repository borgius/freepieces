<!-- markdownlint-disable-file -->

# Task Details: Piece Action "Try it" Tab

## Research Reference

**Source Research**: #file:../research/20260521-piece-action-try-it-tab-research.md

---

## Phase 1: Backend — Admin Run Proxy Endpoint

### Task 1.1: Import auth-resolve and ap-context helpers in admin-api.ts

Add the following imports to `src/routes/admin-api.ts` alongside the existing registry import:

```typescript
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth, forceRefreshNativeAuth } from '../lib/auth-resolve';
import { buildApContext } from '../lib/ap-context';
```

- **Files**:
  - `src/routes/admin-api.ts` — add two import lines after the existing `import { listPieces, getPiece, getTrigger } from '../framework/registry';` line (currently line 10)
- **Success**:
  - No TypeScript errors after adding imports
  - `npm run check` passes
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 110-115) — Key imports from runtime-api.ts
- **Dependencies**:
  - None

### Task 1.2: Add `POST /admin/api/run/:piece/:action` route

Add the following route to `src/routes/admin-api.ts`, placed **before** the final catch-all route `adminApi.all('*', ...)`:

```typescript
// POST /admin/api/run/:piece/:action — admin-privileged action execution (Try it)
adminApi.post('/run/:piece/:action', async (c) => {
  const pieceName = c.req.param('piece');
  const actionName = c.req.param('action');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);

  let body: { userId?: string; pieceToken?: string; props?: Record<string, unknown> } = {};
  try { body = await c.req.json(); } catch { /* empty body is fine */ }

  const { userId, pieceToken, props = {} } = body;

  try {
    let result: unknown;

    if (stored.kind === 'native') {
      const piece = stored.def;
      const action = piece.actions.find((a) => a.name === actionName);
      if (!action) return c.json({ error: 'Action not found' }, 404);

      const auth = await resolveNativeRuntimeAuth(pieceName, piece.auth, c.env, userId, pieceToken);
      result = await action.run({
        auth,
        props,
        env: c.env,
        refreshAuth: async () => {
          const refreshed = await forceRefreshNativeAuth(pieceName, piece.auth, c.env, userId);
          return refreshed ?? undefined;
        },
      });
    } else {
      const { piece } = stored;
      const action = piece._actions[actionName];
      if (!action) return c.json({ error: 'Action not found' }, 404);

      const auth = await resolveApRuntimeAuth(pieceName, piece, c.env, userId, pieceToken);
      const apCtx = buildApContext(pieceName, piece, auth, props, c.env);
      result = await action.run(apCtx);
    }

    return c.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action execution failed';
    return c.json({ ok: false, error: message }, 500);
  }
});
```

- **Files**:
  - `src/routes/admin-api.ts` — insert this route before the final `adminApi.all('*', ...)` catch-all (currently the last ~3 lines of the file)
- **Success**:
  - `curl -X POST /admin/api/run/:piece/:action` with an admin session cookie returns `{ ok: true, result }` or `{ ok: false, error }`
  - Returns 404 when piece or action is not found
  - TypeScript checks pass
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 91-130) — Runtime endpoint pattern to replicate; security/auth notes
- **Dependencies**:
  - Task 1.1 (imports) must be completed first

---

## Phase 2: API Client

### Task 2.1: Add `runActionAsAdmin()` to admin lib

Add the following export at the end of `src/admin/lib/api.ts`, after the last exported function:

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
  return apiFetch<{ ok: true; result: unknown } | { ok: false; error: string }>(
    `/admin/api/run/${encodeURIComponent(pieceName)}/${encodeURIComponent(actionName)}`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}
```

- **Files**:
  - `src/admin/lib/api.ts` — append after the last existing exported function
- **Success**:
  - Function is callable from React components with correct TypeScript types
  - TypeScript checks pass
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 132-150) — API client function design
- **Dependencies**:
  - Phase 1 complete (backend endpoint must exist)

---

## Phase 3: Frontend — ActionTryItTab Component

### Task 3.1: Create `src/admin/components/ItemTryIt.tsx`

Create a new file. Full implementation structure below.

**Imports needed**:
- `useState`, `useEffect` from react
- Chakra UI: `Alert`, `Badge`, `Box`, `Button`, `Checkbox`, `Field`, `Flex`, `Input`, `NativeSelect`, `Spinner`, `Text`, `Textarea`, `VStack`
- `runActionAsAdmin`, `listPieceUsers` from `../lib/api`
- `type PieceAuth`, `type PieceUser`, `type PropDef` from `../lib/api`
- `CodeBlock` from `./ItemUsage` (reuse for response display)

**Prop → Input mapping** (implement as `PropInput` sub-component or inline in form):

| PropDef type | Input element | Notes |
|---|---|---|
| `NUMBER` | `<Input type="number">` | Parse with `parseFloat()` before submit |
| `CHECKBOX` | `<Checkbox>` + hidden state | State is boolean, not string |
| `LONG_TEXT`, `JSON`, `OBJECT`, `ARRAY` | `<Textarea>` | JSON types: parse with `JSON.parse()` before submit |
| `DATE_TIME` | `<Input type="datetime-local">` | |
| `FILE` | disabled text showing "File upload not supported" | Skip from props submit |
| Everything else (`SHORT_TEXT`, `SELECT`, `STATIC_SELECT`, `MULTI_SELECT`, `OAUTH_DYNAMIC_SELECT`, `DYNAMIC`, etc.) | `<Input type="text">` | SELECT/MULTI/DYNAMIC: add a `description` note below |

**User selector** (shown when `pieceSupportsUsers` is true):
- Load users via `listPieceUsers(pieceName)` on component mount
- Show a `<NativeSelect>` with options built from `PieceUser[]`
- Include an empty placeholder option `""` (meaning "no user / use pieceToken instead")
- Show a spinner while loading, an error note if load fails

**pieceToken input** (shown when auth type includes `apiKey`, `SECRET_TEXT`, `CUSTOM_AUTH`, or `BASIC_AUTH`, and `!pieceSupportsUsers`):
- `<Input type="password">` with label "Piece Token / API Key"
- Maps to `pieceToken` in the request body

**Run button**: disabled when `running` is true; shows spinner icon when `running`.

**Response display**:
- Success: render `<CodeBlock label="Response" code={JSON.stringify(result, null, 2)} />`
- Error: render a red `<Alert>` with the error message
- Clear previous result/error when a new run starts

**Value parsing helper** (before calling `runActionAsAdmin`):
```typescript
function parseValue(type: string, raw: string): unknown {
  if (raw === '') return undefined;
  if (type === 'NUMBER') return parseFloat(raw);
  if (type === 'JSON' || type === 'OBJECT' || type === 'ARRAY') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}
```

**Checkbox state**: Use a separate `Record<string, boolean>` for checkbox prop values, merged with string values at submit time.

**Full component signature**:
```typescript
export function ActionTryItTab({
  pieceName,
  actionName,
  props,
  pieceAuth,
  pieceSupportsUsers,
}: {
  pieceName: string;
  actionName: string;
  props: Record<string, PropDef> | null;
  pieceAuth: PieceAuth;
  pieceSupportsUsers: boolean;
})
```

**Auth type detection helper**:
```typescript
function getAuthTypes(auth: PieceAuth): string[] {
  if (!auth) return [];
  return (Array.isArray(auth) ? auth : [auth]).map((a) => a.type);
}
function isOAuth2(auth: PieceAuth): boolean {
  const types = getAuthTypes(auth);
  return types.includes('oauth2') || types.includes('OAUTH2');
}
function needsPieceToken(auth: PieceAuth): boolean {
  const types = getAuthTypes(auth);
  return types.some((t) => ['apiKey', 'SECRET_TEXT', 'CUSTOM_AUTH', 'BASIC_AUTH'].includes(t));
}
```

- **Files**:
  - `src/admin/components/ItemTryIt.tsx` — create new file
- **Success**:
  - Component renders without errors for actions with and without props
  - User selector loads and populates from API for OAuth2 pieces
  - Run button is disabled while request is in-flight
  - Successful response shows formatted JSON; error shows red alert
  - TypeScript checks pass
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 152-225) — Component architecture, prop type mapping, auth detection
- **Dependencies**:
  - Phase 2 (`runActionAsAdmin`) must be complete

---

## Phase 4: Wire into Dialog

### Task 4.1: Update `ItemRowProps` and `SectionProps`

In `src/admin/components/ItemSection.tsx`:

**`ItemRowProps` interface** — add two optional fields at the end of the interface:
```typescript
pieceAuth?: PieceAuth;
pieceSupportsUsers?: boolean;
```

Also add `PieceAuth` to the type imports from `../lib/api`:
```typescript
import type { PieceAction, PieceTrigger, PropDef, PieceAuth } from '../lib/api';
```

**`SectionProps` interface** — add same two optional fields:
```typescript
pieceAuth?: PieceAuth;
pieceSupportsUsers?: boolean;
```

- **Files**:
  - `src/admin/components/ItemSection.tsx` — update two interfaces and the import line
- **Success**:
  - TypeScript accepts the new props without errors
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 228-250) — Interface changes
- **Dependencies**:
  - Phase 3 component must exist so the import won't break in Task 4.2

### Task 4.2: Add "Try it" tab to `ItemRow` dialog

In `src/admin/components/ItemSection.tsx`, inside `ItemRow`:

1. Destructure `pieceAuth` and `pieceSupportsUsers` from props
2. Add import at the top: `import { ActionTryItTab } from './ItemTryIt';`
3. Inside `Tabs.List` (after the `mcp` trigger): 
```tsx
{kind === 'action' && (
  <Tabs.Trigger value="tryit">Try it</Tabs.Trigger>
)}
```
4. Inside `Tabs.Root` content area (after the `mcp` `Tabs.Content`):
```tsx
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

- **Files**:
  - `src/admin/components/ItemSection.tsx` — modify `ItemRow` function body
- **Success**:
  - "Try it" tab appears only on action dialogs
  - Clicking "Try it" tab renders `ActionTryItTab`
  - Trigger dialogs still show only 3 tabs
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 252-275) — Tab wiring
- **Dependencies**:
  - Task 4.1 (props updated)
  - Phase 3 (`ItemTryIt.tsx` created)

### Task 4.3: Update `CollapsibleSection` to forward auth props

In `src/admin/components/ItemSection.tsx`, inside `CollapsibleSection`:

1. Destructure `pieceAuth` and `pieceSupportsUsers` from the function params
2. Pass them to each `<ItemRow>` in the items map:
```tsx
<ItemRow
  key={item.name}
  pieceName={pieceName}
  name={item.name}
  displayName={item.displayName}
  description={item.description}
  props={item.props}
  accentColor={accentColor}
  badge={badgeKey ? String((item as unknown as Record<string, unknown>)[badgeKey] ?? '') : undefined}
  badgePalette={badgePalette}
  kind={kind}
  triggerType={kind === 'trigger' ? (item as PieceTrigger).type : undefined}
  pieceAuth={pieceAuth}
  pieceSupportsUsers={pieceSupportsUsers}
/>
```

- **Files**:
  - `src/admin/components/ItemSection.tsx` — update `CollapsibleSection` destructuring and `ItemRow` usage
- **Success**:
  - `pieceAuth` and `pieceSupportsUsers` flow correctly to `ItemRow`
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 276-295) — CollapsibleSection changes
- **Dependencies**:
  - Task 4.1 (interfaces updated)

### Task 4.4: Update `PieceCard.tsx` to pass auth props

In `src/admin/components/PieceCard.tsx`, find the `<CollapsibleSection>` for actions (the one with `title="Actions"`) and add:
```tsx
pieceAuth={piece.auth}
pieceSupportsUsers={piece.supportsUsers}
```

The triggers `<CollapsibleSection>` does not need these props (Try it is actions-only).

- **Files**:
  - `src/admin/components/PieceCard.tsx` — update the actions `CollapsibleSection` JSX
- **Success**:
  - Auth metadata is available in action `ItemRow` dialogs
  - OAuth2 pieces show user selector in "Try it" tab
  - No-auth pieces show no auth inputs
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 152-165) — PieceCard changes
- **Dependencies**:
  - Task 4.3 complete

---

## Phase 5: Validation

### Task 5.1: Run validation suite

Run in order:
1. `npm test` — must pass with no regressions
2. `npm run check` — TypeScript must pass
3. `npm run build` — must succeed (required by AGENTS.md)

If any step fails, diagnose and fix before marking complete.

- **Files**: All modified files
- **Success**:
  - All three commands exit 0
- **Research References**:
  - #file:../research/20260521-piece-action-try-it-tab-research.md (Lines 310-325) — Validation checklist
- **Dependencies**:
  - All previous phases complete

---

## Dependencies

- Chakra UI v3 (`@chakra-ui/react`) — `NativeSelect`, `Field`, `Input`, `Textarea`, `Checkbox`, `Alert`, `Spinner`, `Button`, `VStack`, `Box`, `Text`, `Flex`, `Badge`
- Hono — `src/routes/admin-api.ts` already uses it
- `resolveNativeRuntimeAuth`, `resolveApRuntimeAuth`, `forceRefreshNativeAuth` — `src/lib/auth-resolve.ts`
- `buildApContext` — `src/lib/ap-context.ts`
- `getPiece` — `src/framework/registry.ts`

## Success Criteria

- "Try it" tab visible in action dialogs, not in trigger dialogs
- OAuth2/OAUTH2 pieces show a user dropdown populated from `/admin/api/pieces/:name/users`
- apiKey/SECRET_TEXT/CUSTOM_AUTH/BASIC_AUTH pieces show a pieceToken password input
- No-auth pieces show only the param form (no auth section)
- Submitting calls `POST /admin/api/run/:piece/:action` and shows formatted JSON response
- Error responses show red alert with the error message
- All existing Params / Usage / MCP tabs unchanged
- `npm test`, `npm run check`, `npm run build` all pass
