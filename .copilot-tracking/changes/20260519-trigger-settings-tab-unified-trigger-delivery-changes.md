# Changes: Global Triggers Settings Grouped by Delivery Endpoint

## Status: In Progress

## Files Modified

_(updated continuously as implementation proceeds)_

---

## Phase 1: Settings shell + TriggersPanel

### `src/admin/pages/SettingsPage.tsx`
- Extended `Section` union type to include `'triggers'`
- Added `Triggers` item to `SECTIONS` with `Webhook` icon
- Widened content area from `maxW="3xl"` to `maxW="5xl"` to accommodate grouped endpoint rows
- Rendered `<TriggersPanel />` when `activeSection === 'triggers'`

### `src/admin/components/TriggersPanel.tsx` _(new file)_
- New global panel component following `SecretsPanel` precedent
- Grouped by delivery target (`callbackUrl` or `queueName`)
- Expandable endpoint group rows showing piece/trigger members
- Per-member metadata: pieceName, triggerDisplayName, triggerType, providerWebhookUrl, owner summary, createdAt
- Refresh and empty/error state handling

## Phase 2: Grouped read model

### `src/lib/webhook.ts`
- Added `listAllSubscriptions(kv)` helper that pages all `sub:` prefixed KV keys and returns `{ pieceName, sub }` tuples

### `src/routes/admin-api.ts`
- Added `GET /admin/api/triggers/groups` endpoint
- Groups subscriptions by `callbackUrl` or `queueName`
- Joins piece and trigger display metadata from registry
- Redacts raw `pieceToken` and `pieceAuthProps` from all responses
- Returns structured `owner` summary instead of raw credentials

### `src/admin/lib/api.ts`
- Added `TriggerGroupsResponse`, `TriggerGroup`, `TriggerMember`, `TriggerOwner`, `TriggerDeliveryTarget` DTOs
- Added `getTriggerGroups()` client helper

## Phase 3: Ownership hardening

### `src/lib/webhook.ts`
- Fixed `sameSubscriptionOwner()` to include `pieceAuthProps` in comparison (prevents custom-auth identity collapse)

## Phase 4: Docs and validation

### `docs/triggers.mdx`
- Updated to describe global `Settings → Triggers` section and grouped delivery endpoint model

### `src/admin/components/ItemUsage.tsx`
- Added hint pointing to `Settings → Triggers` for subscription management
