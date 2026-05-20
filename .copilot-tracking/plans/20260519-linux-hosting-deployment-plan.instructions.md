---
applyTo: ".copilot-tracking/changes/20260519-linux-hosting-deployment-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Linux Hosting Deployment for freepieces

## Overview

Add a Node.js/Linux server deployment path so freepieces can run on any Linux host (VPS, Docker, systemd) without Cloudflare — same HTTP API, same admin SPA, same auth flow, no CF regressions.

## Objectives

- All existing HTTP routes work identically on Linux: `/health`, `/pieces`, `/admin/`, `/admin/api/*`, `/run/:piece/:action`, `/auth/*`, `/mcp/*`
- Admin SPA loads from `dist/public/` with client-side routing fallback
- OpenAuth email login works via SMTP (replaces Cloudflare Email Workers)
- OAuth2 tokens and webhook subscriptions persist across restarts (file-backed KV)
- CF Worker deployment continues to work unchanged
- `npm test` and `npm run check` pass with no regressions

## Research Summary

### Project Files

- `src/worker/create-worker.ts` — Hono app factory; `ASSETS`, `ExecutionContext.waitUntil`, `MessageBatch`
- `src/framework/types.ts` — `Env` interface with all CF binding types
- `src/lib/token-store.ts` — KV CRUD for OAuth tokens (get/put/delete/list)
- `src/lib/env.ts` — duck-typed KV binding resolver (`'get' in obj`)
- `src/lib/webhook.ts` — KV CRUD for subscriptions; queue producer `queue.send()`
- `src/routes/webhook-api.ts` — sole `executionCtx.waitUntil()` usage (line 95)
- `src/auth/issuer.ts` — hardcodes `CloudflareStorage`; needs optional `storage` param
- `src/auth/email.ts` — `cloudflare:email` dynamic import already guarded (lines 60–63)
- `package.json` — no `@hono/node-server` or `nodemailer` yet
- `wrangler.toml` — KV, email, assets, queue bindings

### External References

- #file:../research/20260519-linux-hosting-deployment-research.md — full CF API inventory, replacements, code samples

## Implementation Checklist

### [ ] Phase 1: Dependencies

- [ ] Task 1.1: Add `@hono/node-server` and `nodemailer` as direct dependencies; add `@types/nodemailer` as devDependency

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 18–35)

### [ ] Phase 2: Minimal source patches

- [ ] Task 2.1: Add optional `storage?: StorageAdapter` param to `createAuthIssuer()` in `src/auth/issuer.ts`

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 38–60)

- [ ] Task 2.2: Guard `executionCtx.waitUntil()` in `src/routes/webhook-api.ts` line 95

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 63–82)

### [ ] Phase 3: Linux infrastructure files

- [ ] Task 3.1: Create `src/lib/linux-kv.ts` — file-backed KV shim implementing get/put/delete/list

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 85–135)

- [ ] Task 3.2: Create `src/lib/linux-email.ts` — nodemailer SMTP email sender

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 138–175)

- [ ] Task 3.3: Create `src/linux-server.ts` — Node.js entrypoint wiring all shims and calling `serve()`

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 178–270)

- [ ] Task 3.4: Create `tsconfig.linux.json` — TypeScript config with Node types only (no CF types)

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 273–310)

### [ ] Phase 4: Build and startup scripts

- [ ] Task 4.1: Add `build:linux`, `start`, and `start:dev` scripts to `package.json`

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 313–330)

- [ ] Task 4.2: Create `scripts/start-linux.sh` — startup helper for systemd/Docker

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 333–360)

- [ ] Task 4.3: Create `Dockerfile` for containerised Linux deployment

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 363–400)

### [ ] Phase 5: Env var and config updates

- [ ] Task 5.1: Add Linux-only env vars to `.env.example` (`PORT`, `FREEPIECES_DATA_DIR`, `SMTP_*`)

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 403–425)

### [ ] Phase 6: Tests

- [ ] Task 6.1: Add unit tests for `src/lib/linux-kv.ts` (get/put/delete/list, persistence)

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 428–460)

- [ ] Task 6.2: Add unit tests for `src/lib/linux-email.ts` (SMTP mock, fallback console log)

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 463–490)

### [ ] Phase 7: Documentation

- [ ] Task 7.1: Add Linux hosting section to `README.md` (quickstart, env vars, Docker, systemd)

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 493–520)

- [ ] Task 7.2: Add `docs/linux-hosting.mdx` with full deployment reference

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 523–550)

- [ ] Task 7.3: Update `AGENTS.md` sync rules to include `src/linux-server.ts` and `src/lib/linux-*.ts`

  - Details: .copilot-tracking/details/20260519-linux-hosting-deployment-details.md (Lines 553–565)

## Dependencies

- `@hono/node-server@^2.0.3` — new direct dependency
- `nodemailer@^7.0.13` — new direct dependency (already in pnpm store as transitive)
- `@types/nodemailer@^6.4.17` — new devDependency
- `@openauthjs/openauth` ≥ 0.4.0 — already installed; `MemoryStorage` available at `@openauthjs/openauth/storage/memory`
- Node.js ≥ 20 on target Linux host

## Success Criteria

- `node dist/linux/linux-server.js` starts and `/health` returns `{"ok":true,...}`
- Admin SPA loads at `/admin/` with full client-side routing
- OpenAuth code login flow completes via SMTP
- OAuth tokens survive server restart (persist in `data/token-store.json`)
- `callbackUrl` subscriptions dispatch webhooks correctly
- `queueName` subscriptions return a clear error on Linux (no queue bindings)
- CF Worker deployment: `npm run deploy` still works with zero change
- `npm test` green; `npm run check` passes
