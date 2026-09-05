# Research: 666-860 postinstall DB init

## R1 — Why `packages/.../init.ts` always fails after publish

- Root `package.json` `files` includes `dist`, `scripts`, `prompts`, `config`, docs — not `packages/`.
- `npm pack --dry-run` shows 0 `packages/` entries; `init.ts` absent.
- Confirmed by issue #860 and #857 pack smoke context.

## R2 — Correct runtime entry

- `@memento/core` exports `initializeDatabase` / `closeDatabase` from `packages/memento-core/src/index.ts`.
- Other shipped scripts already `import { initializeDatabase } from '@memento/core'`.
- Core `db:init` script runs `node dist/.../init.js`, but CLI side-effect only runs when `argv[1].endsWith('init.ts')` — **`.js` spawn does not initialize**. Function call is required.

Decision: dynamic `import('@memento/core')` then `await initializeDatabase(); closeDatabase(db)`.

## R3 — Failure visibility

- Current `catch` logs warning + suggests `npm run db:init` (workspace-only) + returns.
- Q1: rethrow / `process.exit(1)` so npm install surfaces failure.
- Native rebuild soft-fail unchanged (Non-Goal).

## R4 — Smoke DB path

- Default `DB_PATH` → `~/ .memento/memory.db` (`environment.ts`).
- Smoke must set `DB_PATH` under smoke temp dir and assert `existsSync`.
- Preserve `MEMENTO_PACK_SMOKE=0` skip.

## R5 — #857 interaction

- Must not reintroduce `.ts` imports in `scripts/**/*.js`.
- Existing `js-scripts-no-ts-import.spec.ts` remains green.
