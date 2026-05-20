# Changes: Linux Hosting Deployment — 2026-05-19

## Summary

Added a Node.js/Linux server deployment path so freepieces can run on any Linux host
(VPS, Docker, systemd) without Cloudflare. All existing HTTP routes, admin SPA, and
auth flow work identically. Cloudflare-specific bindings are replaced by local equivalents.

## Files Changed

### New Files
- `src/lib/linux-kv.ts` — file-backed KV shim implementing get/put/delete/list
- `src/lib/linux-email.ts` — nodemailer SMTP sender with console fallback for dev
- `src/linux-server.ts` — Node.js entrypoint: wires shims, serves static admin SPA, starts HTTP server
- `src/lib/linux-kv.test.ts` — 8 unit tests for file-backed KV (persistence, CRUD, prefix filter)
- `src/lib/linux-email.test.ts` — 4 unit tests for SMTP sender (fallback, sendMail args, alternate sender)
- `tsconfig.linux.json` — TypeScript config for Node.js build (CF types included for source compat)
- `scripts/start-linux.sh` — startup helper (loads .env, builds if needed, starts server)
- `Dockerfile` — multi-stage Docker build (builder + runtime stages)
- `docs/linux-hosting.mdx` — full Linux deployment reference doc

### Modified Files
- `src/auth/issuer.ts` — added optional `storage?` and `sendCode?` params to `createAuthIssuer()`
- `src/lib/auth-issuer.ts` — added `IssuerOpts` interface and optional `opts?` param to `getIssuerApp()`
- `src/routes/webhook-api.ts` — guarded `executionCtx.waitUntil()` with `setImmediate` fallback for Node.js
- `package.json` — added `@hono/node-server`, `nodemailer` dependencies; `@types/nodemailer` devDep; `build:linux`, `start`, `start:dev` scripts
- `.env.example` — added Linux-only env var section (PORT, FREEPIECES_DATA_DIR, SMTP_*)
- `README.md` — added "Linux / Self-hosted Deployment" section with quickstart, Docker, and comparison table
- `AGENTS.md` — added Linux entrypoint files to sync surfaces list

## Phases Completed

- [x] Phase 1: Dependencies (`@hono/node-server`, `nodemailer`, `@types/nodemailer`)
- [x] Phase 2: Minimal source patches (issuer.ts, webhook-api.ts, auth-issuer.ts)
- [x] Phase 3: Linux infrastructure files (linux-kv.ts, linux-email.ts, linux-server.ts, tsconfig.linux.json)
- [x] Phase 4: Build and startup scripts (package.json scripts, start-linux.sh, Dockerfile)
- [x] Phase 5: Env var updates (.env.example)
- [x] Phase 6: Tests (linux-kv.test.ts, linux-email.test.ts)
- [x] Phase 7: Documentation (README.md, docs/linux-hosting.mdx, AGENTS.md)

## Validation

- `pnpm run check` — passes (all tsconfigs)
- `tsc --project tsconfig.linux.json --noEmit` — passes
- `pnpm test` — 139/139 tests pass (20 test files, no regressions)
- New linux tests: 13/13 pass
