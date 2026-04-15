# AGENTS.md

Workspace instructions for `freepieces`.

## What must stay in sync

For any new feature, bug fix, or public behavior change, update every affected surface in the same change:

- `src/worker.ts` and shared runtime helpers
- SDK types/client/examples (`src/sdk/**`, `examples/sdk-example.ts`)
- CLI scaffolding/config/help text (`src/cli/**`) when secrets, flags, or env vars change
- Script/example entrypoints (`src/client/**`, `examples/**`) when runtime calling conventions change
- `README.md` for any user-facing change
- `docs/` for any change to auth headers, routes, or request contracts
- Tests for every new behavior or new functionality

Do not ship a worker-only change when the SDK, CLI, examples, or docs still describe the old contract.

## Runtime auth contract

When `RUN_API_KEY` is configured:

- `Authorization: Bearer <RUN_API_KEY>` authenticates the caller
- `X-User-Id: <userId>` selects the stored OAuth2 token from KV
- `X-Piece-Token: <token>` carries a direct runtime credential for API-key or `CUSTOM_AUTH` pieces (maps to the **first** auth prop)
- `X-Piece-Auth: {"prop":"val",…}` carries multiple named credentials for multi-prop `CUSTOM_AUTH` pieces; value is a JSON object of string key/value pairs

When `RUN_API_KEY` is absent (local dev), the bearer token is the fallback for both modes. Prefer keeping `X-User-Id`, `X-Piece-Token`, and `X-Piece-Auth` support wired in examples and clients so local and deployed behavior stay aligned.

## Validation before finishing

Run the relevant checks after edits:

- `npm test`
- `npm run check`

If auth, headers, or route behavior changed, add or update targeted unit tests instead of relying on manual testing alone.

## No personal data in source files

Never hardcode personal identifiers in source files, examples, config, or comments:

- **No** real email addresses, user IDs, Cloudflare subdomains, KV namespace IDs, or any other PI
- Always use `.env` variable references (e.g. `process.env['USER_ID']`, `${TOKEN_STORE_ID}`) in code and config
- Use generic placeholders in examples (e.g. `your-user-id`, `your@email.com`, `<your-worker>.workers.dev`)
- `.env` is gitignored — real values live there only and are never committed

## Final simplification pass

Before ending any task that changes code:

- Run the `code-simplifier` skill (`.agents/skills/code-simplifier/SKILL.md`)
- Review only the files touched in the current session
- Apply safe readability and maintainability refactors that preserve behavior exactly
- If the simplification pass changes code, re-run any affected validation before finishing
