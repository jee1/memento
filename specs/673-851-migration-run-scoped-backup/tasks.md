# Tasks: Migration Run-Scoped Backup

**Feature**: 673-851-migration-run-scoped-backup  
**Issue**: #851  
**Branch**: `feature/chore-db-1-40-1`  
**Date**: 2026-09-06

## Phase checkpoints

- Setup → Foundational sequential
- US1/US4 TDD then implement
- US2/US3 assertions with same change
- Polish + review
- AUTO-APPROVE phase checkpoints (user Speckit #851 full pipeline)

---

## Phase 0 — Setup

- [x] T001 Confirm call graph: init → `runMigrations`; `rollbackMigration` ignores backup path
- [x] T002 [P] Note baseline `migration-runner.spec.ts` createBackup=false coverage

## Phase 1 — Foundational

- [x] T003 Extract shared `createBackupWithCleanup` helper for run scope and single `runMigration`

## Phase 2 — US1 + US4 Run-scoped create count [TDD]

- [x] T004 [TDD] [US1] [US4] RED→GREEN: `runMigrations` N≥5, `createBackup: true` → createBackup ×1
- [x] T005 [TDD] [US1] empty list / `createBackup: false` → 0 creates
- [x] T006 [US1] GREEN: hoist backup to `runMigrations`; pass `createBackup: false` into loop
- [x] T007 [P] [US1] Assert `cleanupBackups` at most once per successful run create

## Phase 3 — US2 Single runMigration

- [x] T008 [TDD] [US2] Direct `runMigration` with `createBackup: true` still creates exactly once (existing tests)

## Phase 4 — US3 Failure semantics

- [x] T009 [TDD] [US3] Mid-batch fail: one create; earlier success retained; failed not recorded
- [x] T010 [TDD] [US3] Backup create rejection aborts before any `up`

## Phase 5 — Polish

- [x] T011 [P] CHANGELOG Unreleased note for #851
- [x] T012 [P] AGENTS.md §3.1 one-liner (migration backup run-scoped)
- [x] T013 Focused vitest `migration-runner.spec.ts` (24 passed)
- [x] T014 `npm run lint` + `npm run type-check` (0 errors / pass)
- [x] T015 Graphify rebuild after production code
- [x] T016 [REVIEW] Superspec review → PASS (I-1 fixed; Critical/Important open = 0)

## Dependencies

```text
T001 → T002 → T003 → T004–T005 → T006–T007 → T008 → T009–T010 → T011–T015 → T016
```

## Parallel opportunities

T007 with T008 after T006; T011∥T012 after tests green.
