# Tasks: 설치 패키지 postinstall DB 초기화

**Input**: Design documents from `/specs/666-860-fix-install-postinstall-db-catch/`
**Prerequisites**: plan.md, spec.md (Brainstormed), research.md

**Tests**: Principle I — TDD required (bug fix).

## Phase 1: Setup

- [x] T001 Create `progress.yml` baseline and confirm worktree branch `feature/fix-install-postinstall-db-catch` (no branch checkout)

## Phase 2: Foundational — helper contract [TDD]

- [x] T002 [TDD] Write failing unit tests for `scripts/lib/postinstall-db-init.js` in `scripts/lib/postinstall-db-init.spec.ts` (success calls core init+close; failure rejects; no packages/ path)
- [x] T003 [TDD] Implement `scripts/lib/postinstall-db-init.js` to satisfy T002 (dynamic `import('@memento/core')`)

## Phase 3: User Story 1 + 2 — auto-setup wiring (P1) [TDD]

- [x] T004 [US1][US2] Wire `scripts/auto-setup.js` `initializeDatabase` to `runPostinstallDbInit`; remove `tsx packages/.../init.ts`; on failure do not swallow (exit non-zero); replace install-invalid `npm run db:init` hint
- [x] T005 [P][US1] Add/extend static guard: `auto-setup.js` must not contain `packages/memento-core/src/infrastructure/database/sqlite/init.ts` (extend `scripts/js-scripts-no-ts-import.spec.ts` or sibling assert)

## Phase 4: User Story 3 — pack smoke DB assert (P2)

- [x] T006 [TDD][US3] Update `scripts/verify-npm-pack-bundle.js` empty-temp smoke: set temp `DB_PATH`, after install assert DB file exists; keep `MEMENTO_PACK_SMOKE=0` skip
- [x] T007 [US3] Run `node scripts/verify-npm-pack-bundle.js` and confirm SC-001/SC-004 path green (or document skip-only env)

## Phase 5: Polish / gates

- [x] T008 [P] Run `npm test -- scripts/lib/postinstall-db-init.spec.ts scripts/js-scripts-no-ts-import.spec.ts`
- [x] T009 Run `npm run lint` and `npm run type-check` as needed for touched paths
- [x] T010 Rebuild graphify (`python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`) since shipped scripts changed
- [x] T011 Update `progress.yml` + mark tasks complete; prepare summary (no commit/push)

## Dependencies

- T002 → T003 → T004
- T005 parallel after T004
- T006 after T004 (needs working postinstall path)
- T007 after T006
- T008–T011 after implementation

## Parallel opportunities

- T005 [P] with docs polish
- Execute US1/US2 then US3 sequentially (smoke depends on fix)
- Review can run parallel with final gates after code complete
