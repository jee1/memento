# Tasks: npm pack scripts allowlist (#859)

**Input**: Design documents from `/specs/676-859-chore-npm-pack-scripts-allowlist/`
**Prerequisites**: plan.md, spec.md (Brainstormed), research.md

**Tests**: Principle I — TDD required.

## Phase 1: Setup

- [x] T001 Create `progress.yml` and confirm branch `feature/chore-build-files-scripts-tarball-.ts-130`

## Phase 2: Foundational — allowlist module [TDD]

- [x] T002 [TDD] Write failing unit tests in `scripts/lib/npm-pack-scripts-allowlist.spec.ts` for `findDisallowedScriptPaths` (`.ts` violation, non-allowlisted `.js`, allowlisted-only pass, directory entries ignored)
- [x] T003 [TDD] Implement `scripts/lib/npm-pack-scripts-allowlist.js` to satisfy T002

## Phase 3: User Story 2 — wire pack gate (P1)

- [x] T004 [US2] Import allowlist check in `scripts/verify-npm-pack-bundle.js` after tar parse; on violations log paths and set non-zero exit (before or with existing dep checks; always runs even if `MEMENTO_PACK_SMOKE=0`)

## Phase 4: User Story 1 + 3 — shrink files + smoke (P1)

- [x] T005 [US1] Update root `package.json` `files` to replace `"scripts"` with the three runtime script paths; keep dist/prompts/config/docs (FR-008)
- [x] T006 [US3] Run `node scripts/verify-npm-pack-bundle.js` and confirm allowlist + #860 DB smoke green

## Phase 5: Polish / gates

- [x] T007 [P] Run `npm test -- scripts/lib/npm-pack-scripts-allowlist.spec.ts scripts/js-scripts-no-ts-import.spec.ts`
- [x] T008 Run `npm run lint` / `npm run type-check` as needed for touched paths
- [x] T009 Rebuild graphify after shipped script changes
- [x] T010 Update `progress.yml` + tasks checkboxes; summary (no commit/push)

## Dependencies

- T002 → T003 → T004
- T005 after T004 (gate must exist before shrinking is “proven”; TDD unit already green)
- T006 after T005
- T007–T010 after implementation

## Parallel opportunities

- Review parallel with T007–T009 after code complete
- T007 [P] with lint/type-check
