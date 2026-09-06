# Tasks: Admin Jobs Dashboard Phase 3 — run logs + pause/resume·Run now

**Input**: `specs/671-834-admin-jobs-dashboard-phase-3/`  
**Prerequisites**: spec.md (Brainstormed), plan.md, research.md, data-model.md, contracts/admin-batch-phase3.md  
**Issue**: [#834](https://github.com/jee1/memento/issues/834)

**Markers**: `[P]` parallel · `[TDD]` red-green-refactor · `[SUBAGENT]` delegable · `[REVIEW]` review gate

## Phase 1: Setup

- [x] T001 Confirm artifacts under `specs/671-834-admin-jobs-dashboard-phase-3/`; set `progress.yml` current_phase=execute when implementation starts
- [x] T002 [P] Skim `admin-batch.routes.ts`, `batch-scheduler-job-runners.ts`, `batch-scheduler-job-control.ts`, `batch-job-execution-coordinator.ts`, `job-run-repository.ts`, `jobs-panel-*` — no code change

---

## Phase 2: Foundational — migration + JobRunLogRepository

**Goal**: `job_run_log` table + append/list; cascade retention path

- [x] T003 [TDD] RED: JobRunLogRepository tests — append, appendMany, listByRunId chronological + limit clamp
- [x] T004 [TDD] GREEN: migration `046-job-run-log.ts` + `schema.sql` mirror + indexes + FK CASCADE
- [x] T005 [TDD] GREEN: implement `JobRunLogRepository` (+ soft-fail helper if needed)
- [x] T006 [P] [TDD] RED/GREEN: parent `deleteExpired` removes child logs (CASCADE or explicit); retention regression

**Checkpoint**: repo + migration tests green

---

## Phase 3: US1 — log append hook + GET logs (P1)

**Goal**: buffer → flush after `job_run` append; GET logs API

- [x] T007 [TDD] RED/GREEN: LogBuffer / sink on schedule coordinator path; flush after schedule `job_run` append (soft-fail FR-010)
- [x] T008 [TDD] RED/GREEN: manual `POST /batch/run` path flushes buffer after manual `job_run` append
- [x] T009 [TDD] RED: admin GET logs contract per `contracts/admin-batch-phase3.md` (200 empty, 404 unknown runId)
- [x] T010 [TDD] GREEN: `GET /batch/runs/:runId/logs` (or agreed query form) in `admin-batch.routes.ts`
- [x] T011 Assert log append/DB failure does not flip job success (US1 / FR-010)

**Checkpoint**: seed run+logs listable via GET

---

## Phase 4: US2 — pause / resume all interval jobs (P1)

**Goal**: pause=stop schedule; resume via expanded restart registry; stats reflect paused

- [x] T012 [TDD] RED/GREEN: expand `restartBatchSchedulerJob` (schedule-name → schedule\* handlers) beyond cleanup|monitoring|healthcheck|memory_review_candidates
- [x] T013 [TDD] RED/GREEN: paused set + `stopJob` wiring; in-flight not force-killed (Q6)
- [x] T014 [TDD] RED: `POST /batch/pause` + `POST /batch/resume` route contract (auth, idempotent, 400 unknown)
- [x] T015 [TDD] GREEN: implement pause/resume routes; stats/status additive `paused` / `enabled` accuracy
- [x] T016 [P] Wire `ADMIN_JOBS_READ_ONLY` config + middleware → writes **403**, GETs OK (FR-008 / Q4)

**Checkpoint**: pause stops ticks; resume restores; read-only blocks writes

---

## Phase 5: US3 — Run now widened + dual-run 409 (P1)

**Goal**: all registered schedule jobs runnable; busy → 409

- [x] T017 [TDD] RED/GREEN: expand `ManualBatchSchedulerJobType` + `runManualBatchSchedulerJob` dispatch to full runner/schedule registry (no orphan runners)
- [x] T018 [TDD] RED/GREEN: widen `POST /batch/run` allowlist to registered set; keep body `{ jobType }`; document intentional widen
- [x] T019 [TDD] RED/GREEN: dual-run guard — `isJobRunning` → **409 Conflict** (SC-003 regression)
- [x] T020 [P] Regression: prior 3 jobTypes still succeed; unknown → 400; read-only → 403

**Checkpoint**: Run now works for non-whitelist jobs; concurrent busy rejects

---

## Phase 6: US1/2/3/4 — Jobs UI (P1 + P2 Retry)

**Goal**: Logs panel; pause/resume/Run now confirm; Retry on failed only

- [x] T021 [TDD] RED: extend `dashboard-jobs-panel.spec.ts` — Logs panel for selected run; confirm dialogs; no SSE requirement
- [x] T022 [SUBAGENT] Update `jobs-panel-*` + `dashboard.html` — Logs tab/panel, Pause/Resume/Run now, confirm UX
- [x] T023 [TDD] GREEN: T021 passes
- [x] T024 [TDD] RED/GREEN: Failed Retry button only when `success=false`; calls same `POST /batch/run` (US4 / FR-009)

**Checkpoint**: UI smoke green for US1–US4

---

## Phase 7: US5 — Queue oldest-age (P3, optional)

**Goal**: stretch only if enqueue timestamp easy

- [x] T025 [P] [TDD] OPTIONAL: JobQueue `enqueuedAt` + stats `oldestWaitingAgeMs` (null/0 when empty); UI one-line — **skipped (P3 defer #834 review)**

**Checkpoint**: SC for FR-012 only if T025 done; else document defer in progress note

---

## Phase 8: Polish

- [x] T026 [P] lint + type-check touched packages
- [x] T027 Focused tests: job-run-log repo + migration + pause/resume + widened run/409 + jobs-panel (+ opt oldest-age)
- [x] T028 graphify rebuild after production edits (`python3 -c "from graphify.watch import _rebuild_code; …"`)
- [x] T029 [REVIEW] `/speckit.superspec.review` until Critical/Important=0 — PASS 2026-09-06
- [x] T030 Update `progress.yml` + summary (no commit unless asked)

---

## Dependencies

```text
T001–T002 → T003–T006 → T007–T011 → T012–T016 → T017–T020 → T021–T024 → T025? → T026–T030
T006 ∥ after T004
T016 ∥ T014–T015
T020 ∥ after T018
T022 ∥ T021 RED
T025 optional / parallel after T015 stats shape known
```

## User story coverage

| US | Tasks |
|----|-------|
| US1 Run logs | T003–T011, T021–T023 |
| US2 Pause/Resume | T012–T016, T021–T023 |
| US3 Run now all jobs | T017–T020, T021–T023 |
| US4 Failed retry | T024 |
| US5 Oldest-age (P3) | T025 optional |
| Polish | T026–T030 |

## AUTO-APPROVE

Speckit plan/tasks canonical; phase checkpoints auto-advance on execute; commit/push require explicit ask.
