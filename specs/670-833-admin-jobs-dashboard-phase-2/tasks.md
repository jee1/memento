# Tasks: Admin Jobs Dashboard Phase 2 — durable job_run

**Input**: `specs/670-833-admin-jobs-dashboard-phase-2/`  
**Prerequisites**: spec.md (Brainstormed), plan.md, research.md, data-model.md, contracts/admin-batch-runs.md  
**Issue**: [#833](https://github.com/jee1/memento/issues/833)

**Markers**: `[P]` parallel · `[TDD]` red-green-refactor · `[SUBAGENT]` delegable · `[REVIEW]` review gate

## Phase 1: Setup

- [x] T001 Confirm artifacts under `specs/670-833-admin-jobs-dashboard-phase-2/`; set `progress.yml` current_phase=execute
- [x] T002 [P] Skim coordinator, admin-batch.routes, batch-run-history, telemetry retention, jobs-panel — no code change

---

## Phase 2: Foundational — migration + repository

**Goal**: `job_run` table + append/list/deleteExpired

- [x] T003 [TDD] RED: JobRunRepository tests — append, list(job/limit), deleteExpired cutoff (`packages/memento-core/...`)
- [x] T004 [TDD] GREEN: migration `044-job-run.ts` + `schema.sql` mirror + indexes
- [x] T005 [TDD] GREEN: implement `JobRunRepository` (append soft-safe helpers; ISO times)
- [x] T006 [P] Wire `JOB_RUN_RETENTION_DAYS` config (≥1, default 90) like telemetry

**Checkpoint**: repo + migration tests green

---

## Phase 3: US1 — append paths (P1)

**Goal**: schedule + manual dual-write; append soft-fail

- [x] T007 [TDD] RED/GREEN: schedule append in `BatchJobExecutionCoordinator.executeJobWithRetry` finally (`trigger=schedule`)
- [x] T008 [TDD] RED/GREEN: manual append on `POST /admin/batch/run` (`trigger=manual`); ring buffer unchanged
- [x] T009 Assert append DB error does not change job HTTP/result success (US1.3 / FR-004)

**Checkpoint**: both triggers produce rows

---

## Phase 4: US2 — GET /admin/batch/runs (P1)

- [x] T010 [TDD] RED: admin route contract per `contracts/admin-batch-runs.md`
- [x] T011 [TDD] GREEN: `GET /batch/runs` in `admin-batch.routes.ts`
- [x] T012 [P] Regression: `/batch/status` `/batch/stats` `/batch/run-history` `/batch/run` still pass

**Checkpoint**: API contract green

---

## Phase 5: US3 — Jobs UI timeline (P1)

- [x] T013 [TDD] RED: extend `dashboard-jobs-panel.spec.ts` — job select → `/runs?job=` · timeline fields · no setInterval
- [x] T014 [SUBAGENT] Update `jobs-panel-*` + `dashboard.html` disclaimer; render timeline
- [x] T015 [TDD] GREEN: T013 passes

**Checkpoint**: UI smoke green

---

## Phase 6: US4 — Retention (P2)

- [x] T016 [TDD] RED/GREEN: deleteExpired + retention env; document in quickstart/research (or short docs note)
- [x] T017 Hook cleanup call site (telemetry_cleanup-adjacent or scheduled path) — document exact hook

**Checkpoint**: SC-003

---

## Phase 7: Polish

- [x] T018 [P] lint + type-check touched packages
- [x] T019 Focused tests: job-run repo + admin runs + jobs-panel + retention
- [x] T020 graphify rebuild after production edits
- [x] T021 [REVIEW] `/speckit.superspec.review` until Critical/Important=0
- [x] T022 Update `progress.yml` + summary (no commit unless asked)

---

## Dependencies

```text
T001–T002 → T003–T006 → T007–T009 → T010–T012 → T013–T015 → T016–T017 → T018–T022
T006 ∥ T005 after T004
T012 ∥ after T011
T014 ∥ T013 RED
```

## AUTO-APPROVE

Speckit canonical (user requested full pipeline): phase checkpoints auto-advance; commit/push require explicit ask.
