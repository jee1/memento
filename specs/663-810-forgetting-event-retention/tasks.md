# Tasks: #810 memory_forgetting_event retention

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Phase 1 — Repository retention [TDD]

- [x] T001 [TDD] `ForgettingEventRepository.deleteExpiredEvents` + unit tests
- [x] T002 [TDD] ISO cutoff `< created_at` boundary tests

## Phase 2 — Batch scheduler [TDD] [P]

- [x] T003 [TDD] `ForgettingEventCleanupBatchJob` + spec
- [x] T004 [P] Wire scheduler: config, handler, recurring schedule, context
- [x] T005 [P] `env.example` — `FORGETTING_EVENT_RETENTION_DAYS`, interval

## Phase 3 — Operator CLI [TDD]

- [x] T006 [TDD] `scripts/lib/db-residue.ts` report + dimensions=0 cleanup
- [x] T007 [TDD] `scripts/db-residue-cleanup.ts` + `scripts/db-vacuum.ts`
- [x] T008 [P] `package.json` — `db:residue`, `db:vacuum`

## Phase 4 — Polish & review

- [x] T009 Run targeted tests (5 green)
- [x] T010 [REVIEW] `/speckit.superspec.review` — checklist-review.md
- [x] T011 `npm run lint && npm run type-check` — targeted tests green

## Traceability

| FR | Tasks |
|----|-------|
| FR-001–004 | T001–T005 |
| FR-005–006 | T006–T008 |
| FR-007–010 | T006–T008, quickstart |
