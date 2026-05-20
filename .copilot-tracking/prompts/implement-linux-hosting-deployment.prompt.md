---
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: Linux Hosting Deployment for freepieces

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260519-linux-hosting-deployment-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow #file:../../.github/instructions/task-implementation.instructions.md
You WILL systematically implement #file:../plans/20260519-linux-hosting-deployment-plan.instructions.md task-by-task
You WILL follow ALL project standards and conventions from #file:../../AGENTS.md

**Critical implementation notes:**

1. **Phase 1 first**: Run `pnpm add @hono/node-server nodemailer && pnpm add -D @types/nodemailer` before writing any code that imports them.

2. **Task 2.1 scope**: The `createAuthIssuer()` signature change in `src/auth/issuer.ts` needs an additional optional third param `sendCode?: (email: string, code: string) => Promise<void>` in addition to `storage?`. This allows the Linux entrypoint to inject SMTP-based code delivery without modifying `src/auth/email.ts`.

3. **Task 3.3 entrypoint approach**: Prefer passing `authStorage` and `sendCode` directly into `createAuthIssuer()` rather than using `__linux_*` env fields. The `src/lib/auth-issuer.ts` `getIssuerApp()` function already accepts `env` — extend it to also accept an optional `opts?: { storage?: StorageAdapter; sendCode?: (email: string, code: string) => Promise<void> }` second parameter and pass these through to `createAuthIssuer()`.

4. **serveStatic SPA fallback**: `@hono/node-server/serve-static` does not natively support SPA fallback. For non-asset `/admin/*` paths, use a separate `app.get('/admin/*', ...)` handler that reads `dist/public/admin/index.html` and returns it, mounted AFTER the `serveStatic` middleware for `/admin/assets/*`.

5. **`files` in `package.json`**: Do NOT add `dist/linux` to the `"files"` array. Linux build outputs are not part of the npm package.

6. **Validation after each phase**: Run `pnpm run check` after Phase 2 and `tsc --project tsconfig.linux.json --noEmit` after Phase 3. Run `pnpm test` after Phase 6.

7. **No personal data**: All env var examples must use generic placeholders (`smtp.example.com`, `noreply@example.com`). No real domains, credentials, or hostnames.

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a summary of all changes from #file:../changes/20260519-linux-hosting-deployment-changes.md to the user:

   - You WILL keep the overall summary brief
   - You WILL add spacing around any lists
   - You MUST wrap any reference to a file in a markdown style link

2. You WILL provide markdown style links to .copilot-tracking/plans/20260519-linux-hosting-deployment-plan.instructions.md, .copilot-tracking/details/20260519-linux-hosting-deployment-details.md, and .copilot-tracking/research/20260519-linux-hosting-deployment-research.md. You WILL recommend cleaning these files up as well.

3. **MANDATORY**: You WILL attempt to delete .copilot-tracking/prompts/implement-linux-hosting-deployment.prompt.md

## Success Criteria

- [ ] Changes tracking file created
- [ ] `pnpm add @hono/node-server nodemailer` completed; `@types/nodemailer` added as devDep
- [ ] `src/auth/issuer.ts` `createAuthIssuer()` accepts optional `storage` and `sendCode` params
- [ ] `src/routes/webhook-api.ts` `executionCtx.waitUntil` guarded with optional chaining + `setImmediate` fallback
- [ ] `src/lib/linux-kv.ts` created and implements full KV shim interface
- [ ] `src/lib/linux-email.ts` created with nodemailer SMTP sender and console fallback
- [ ] `src/linux-server.ts` created and starts an HTTP server on `PORT`
- [ ] `tsconfig.linux.json` created with Node-only types
- [ ] `build:linux`, `start`, `start:dev` scripts added to `package.json`
- [ ] `scripts/start-linux.sh` created and executable
- [ ] `Dockerfile` created with multi-stage build
- [ ] `.env.example` updated with Linux-only env vars
- [ ] `src/lib/linux-kv.test.ts` added with persistence and CRUD coverage
- [ ] `src/lib/linux-email.test.ts` added with SMTP mock and fallback coverage
- [ ] `README.md` has Linux hosting quickstart section
- [ ] `docs/linux-hosting.mdx` created with full reference
- [ ] `AGENTS.md` updated to include Linux entrypoint in sync surfaces
- [ ] `pnpm test` passes with no regressions
- [ ] `pnpm run check` passes
- [ ] `tsc --project tsconfig.linux.json --noEmit` passes
