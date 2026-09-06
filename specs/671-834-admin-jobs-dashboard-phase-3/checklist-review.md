# SpecKit Superspec Review — #834 Admin Jobs Dashboard Phase 3

**Date**: 2026-09-06  
**Branch**: `feature/feat-admin-jobs-dashboard-phase-3-run-pause-resu`  
**Reviewer**: `/speckit.superspec.review`  
**Verdict**: **PASS**

## Summary

Phase 3 delivers `job_run_log` (migration 046), GET logs, pause/resume, widened Run now, read-only guard, Jobs UI (Logs + confirm writes + Retry), and soft-fail log append per FR-010. US1–US4 are implemented; US5 (oldest-age) is intentionally deferred (T025 skipped).

One **Important** gap was found during review: manual `runJob` did not mark the JobQueue running set, so two concurrent Run now requests could overlap despite the route-level `isJobRunning` check (TOCTOU). This was **fixed** with sync check+mark in `BatchScheduler.runJob` and `BatchJobAlreadyRunningError` → 409 mapping. Constitution II CHANGELOG note for `/batch/run` widen was also added.

Focused tests (109 + 2 new run-job tests), lint, type-check, and graphify rebuild pass.

## Spec compliance

| Story | Status | Evidence |
|-------|--------|----------|
| US1 Run logs | PASS | `046-job-run-log`, `JobRunLogRepository`, coordinator buffer flush, `GET /batch/runs/:runId/logs`, UI Logs panel |
| US2 Pause/Resume | PASS | `pauseJob`/`resumeJob`, expanded restart registry, stats `paused`/`enabled`, read-only 403 |
| US3 Run now (all jobs) | PASS | `REGISTERED_MANUAL_BATCH_JOB_TYPES`, widened `POST /batch/run`, 409 dual-run (fixed) |
| US4 Failed retry | PASS | Retry button on `success=false` only; same `POST /batch/run` |
| US5 Oldest-age (P3) | SKIPPED | T025 optional — not implemented (documented) |

## Constitution gates

| Principle | Status | Notes |
|-----------|--------|-------|
| I Test-first | PASS | RED/GREEN specs for repo, routes, coordinator, UI |
| II Backward compat | PASS | GETs unchanged; POST `/batch/run` widen documented in contract + CHANGELOG |
| III Schema/migration | PASS | 046 + `schema.sql` mirror, FK CASCADE, auto-detect via `MigrationDetector` |
| IV Quality gates | PASS | lint, type-check, focused vitest, graphify rebuild |
| V Observability / soft-fail | PASS | `appendJobRunLogSafe`, flush soft-fail; job outcome isolated (FR-010) |

## Findings (confidence ≥ 80)

### Critical — 0

(none)

### Important — 0 (1 fixed in review)

| ID | Location | Issue | Resolution | Confidence |
|----|----------|-------|------------|------------|
| I-001 | `batch-scheduler.ts` `runJob`, `admin-batch.routes.ts` | Manual Run now did not atomically acquire JobQueue running mark; concurrent POSTs could dual-execute (SC-003 / FR-006) | Added sync `isRunning` → `markRunning` / `finally markCompleted`; `BatchJobAlreadyRunningError` → 409; tests in `run-job.spec.ts` | 92 |

### Suggestion — 1 (non-blocking)

| ID | Location | Issue | Recommendation | Confidence |
|----|----------|-------|----------------|------------|
| S-001 | `batch-scheduler.ts` infra jobs | `wal_checkpoint`, `lock_monitor`, `reflexion_*` are scheduled but excluded from manual registry (by design — no runners) | Document in ops quickstart if operators expect pause/Run on infra jobs | 82 |

## Security & edge cases

- Admin auth: reuses existing `/admin/batch/*` middleware (unchanged).
- Read-only: `ADMIN_JOBS_READ_ONLY` → writes 403, GETs OK (tested).
- Unknown `runId` → 404; empty logs → 200 `[]`.
- Bad log JSON → `context: null` (no 500).
- Pause + Run now: allowed; schedule stays paused.
- Log size: message/context truncate in repository (2KB / 16KB).

## Tests run (review)

```text
job-run-log-repository.spec.ts, 046-job-run-log.spec.ts,
batch-scheduler-job-control-pause.spec.ts, batch-scheduler-job-runners-registry.spec.ts,
batch-job-execution-coordinator.spec.ts, admin.routes.spec.ts,
dashboard-jobs-panel.spec.ts, run-job.spec.ts (post-fix)
→ all green
npm run lint, npm run type-check → pass
graphify rebuild → ok
```

## Files fixed during review

- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler/batch-scheduler-types.ts` — `BatchJobAlreadyRunningError`
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler/batch-scheduler.ts` — running lock in `runJob`
- `packages/memento-core/src/index.ts` — export error class
- `packages/memento-server/src/server/routes/admin/admin-batch.routes.ts` — 409 from `runJob` throw
- `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler/run-job.spec.ts` — SC-003 regression
- `CHANGELOG.md` — II compat note for `/batch/run` widen

## Merge opinion

**PASS** — Critical/Important = 0 after surgical dual-run fix. US5 deferral is explicit and acceptable.
