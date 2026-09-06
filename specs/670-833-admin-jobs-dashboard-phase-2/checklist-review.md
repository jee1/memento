# Spec Review: Admin Jobs Dashboard Phase 2 — durable job_run (#833)

**Reviewed**: 2026-09-06  
**Branch**: `feature/feat-admin-jobs-dashboard-phase-2-durable-job_ru`  
**Spec**: [spec.md](./spec.md) · **Contract**: [contracts/admin-batch-runs.md](./contracts/admin-batch-runs.md)  
**Reviewer**: code-review-specialist (`/speckit.superspec.review`)

## Verdict

### **PASS**

구현이 FR-001~009, SC-001~005, User Story acceptance, brainstorm edge cases, Constitution I–V와 정합합니다. confidence ≥ 80 이슈 없음.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Important | 0 |
| Suggestion (≥80, non-blocking) | 0 |

## Findings (confidence ≥ 80 only)

| Severity | Confidence | Location | Issue | Fix |
|----------|------------|----------|-------|-----|
| — | — | — | **No blocking or important findings** | — |

> confidence < 80 후보(보고 생략): SC-001 프로세스 재기동 E2E 테스트 부재(SQLite 영속성으로 아키텍처상 충족); FR-004 manual HTTP 경로 통합 테스트 부재(`appendJobRunSafe` 단위 테스트로 커버); 재시도마다 `job_run` 실패 행 추가(시도 단위 이력으로 스펙 허용).

## FR / SC Checklist

| ID | Status | Evidence |
|----|--------|----------|
| **FR-001** | **met** | Migration 044 + `schema.sql:805–820` — `id`, `job_name`, `trigger`, `started_at`, `ended_at`, `success`, `duration_ms`, `processed`, `error_count`, `details_json` |
| **FR-002** | **met** | `BatchJobExecutionCoordinator.executeJobWithRetry` `finally` → `appendScheduleJobRun` (`trigger=schedule`) — `batch-job-execution-coordinator.ts:231–266` |
| **FR-003** | **met** | `POST /admin/batch/run` → `appendJobRunSafe(..., trigger: 'manual')` — `admin-batch.routes.ts:222–267`; ring buffer `recordManualBatchRun*` 유지 — `#295` 회귀 테스트 green |
| **FR-004** | **met** | `appendJobRunSafe` / coordinator inline try-catch — never throws; job outcome unchanged — `job-run-repository.ts:113–129`, `batch-job-execution-coordinator.spec.ts:197–233` |
| **FR-005** | **met** | `GET /admin/batch/runs` — optional `job`, `limit` clamp 1..100 default 50, newest-first — `admin-batch.routes.ts:182–206`, `job-run-repository.ts:76–98` |
| **FR-006** | **met** | Jobs panel: schedule row click → `/runs?job=`; Refresh only — `jobs-panel.js:20–29`, `jobs-panel-fetch.js:25–84`, `dashboard-jobs-panel.spec.ts:251+` |
| **FR-007** | **met** | `JOB_RUN_RETENTION_DAYS` default 90, ≥1 validation — `job-run-cleanup-batch-job.ts:34–39`; `deleteExpired` JS ISO cutoff — `job-run-repository.ts:101–106`; scheduled `job_run_cleanup_batch` — `batch-recurring-schedules.ts:267–275` |
| **FR-008** | **met** | `044-job-run.ts` + auto-detect; `schema.sql` mirror; migration spec — `044-job-run.spec.ts` |
| **FR-009** | **met** | `/batch/status`, `/batch/stats`, `/batch/run-history`, `/batch/run` whitelist unchanged — `admin.routes.spec.ts` 회귀 green |
| **SC-001** | **met** | SQLite persistence; `GET /runs` reads DB rows (seed + manual run integration tests) |
| **SC-002** | **met** | Schedule: `batch-job-execution-coordinator.spec.ts:147–195`; Manual: `admin.routes.spec.ts:1476–1516` |
| **SC-003** | **met** | Retention unit + batch job tests — `job-run-repository.spec.ts:111–134`, `job-run-cleanup-batch-job.spec.ts`; docs: `quickstart.md`, `data-model.md`, `dashboard.html:346` |
| **SC-004** | **met** | Timeline renders start/end/duration/success — `jobs-panel-render.js:96–105`; no auto-poll — `dashboard-jobs-panel.spec.ts:66–73` |
| **SC-005** | **met** | TDD tests green; focused suite 26/26 pass (2026-09-06) |

## User Story Acceptance

| Story | Scenario | Status | Notes |
|-------|----------|--------|-------|
| **US1** | 1 — schedule success/failure row | **met** | Coordinator append with ISO times + duration |
| **US1** | 2 — manual dual-write + ring buffer | **met** | Manual trigger only on POST path; `runJob` bypasses coordinator (no double append) |
| **US1** | 3 — append DB error isolation | **met** | Soft-fail + warn log; primary outcome preserved |
| **US2** | 1 — limit + newest-first | **met** | `ORDER BY started_at DESC, id DESC` |
| **US2** | 2 — job filter | **met** | `?job=` exact match |
| **US2** | 3 — empty → 200 [] | **met** | `admin.routes.spec.ts:1463–1473` |
| **US3** | 1 — select row → timeline | **met** | Click handler + `/runs?job=` |
| **US3** | 2 — Refresh updates | **met** | `refresh()` fetches `/runs` alongside stats/history |
| **US3** | 3 — durable disclaimer | **met** | `dashboard.html:346,380`; no `재시작 후 소멸` — `dashboard-jobs-panel.spec.ts:51–57` |
| **US4** | 1 — retention DELETE cutoff | **met** | ISO JS cutoff, not SQL `CURRENT_TIMESTAMP` alone |
| **US4** | 2 — retention documented | **met** | `quickstart.md` §5, `data-model.md`, UI intro |

## Brainstorm / Edge Cases

| Edge case | Status | Evidence |
|-----------|--------|----------|
| Concurrent schedule + manual same job | **met** | Both append; order by `started_at` |
| Missing processed/details on schedule void runners | **met** | Nullable columns; coordinator append omits optional fields (spec OK) |
| Invalid limit / unknown job | **met** | Clamp / empty list |
| DB unavailable at append | **met** | Soft-fail; job outcome unchanged |
| Retention env `< 1` | **met** | `resolveValidatedNumber` validator `n >= 1` → fallback default 90 |

## Constitution Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **I — Test-First** | **PASS** | Migration, repo, coordinator, admin routes, UI smoke, retention tests |
| **II — Backward compatibility** | **PASS** | Additive `/runs`; existing batch routes unchanged |
| **III — Schema/migration** | **PASS** | 044 + `schema.sql` mirror + indexes |
| **IV — Quality gates** | **PASS** | Focused tests green (2026-09-06) |
| **V — Observability / soft-fail** | **PASS** | Append failures → warn log; job HTTP/scheduler outcome not flipped |

## Contract Compliance (`admin-batch-runs.md`)

| Rule | Status |
|------|--------|
| 200 shape (runs[], limit) | **met** |
| camelCase wire fields | **met** — `toJobRunResponse` |
| Newest-first order | **met** |
| Empty → `{ runs: [], limit: N }` | **met** |
| Bad `details_json` → null (no 500) | **met** — try/catch in `toJobRunResponse` |
| Auth same as sibling `/admin/batch/*` | **met** — inherited Admin router |

## Key Implementation Notes (review trace)

| Component | Role |
|-----------|------|
| `044-job-run.ts` | DDL + indexes |
| `job-run-repository.ts` | append / list / deleteExpired / `appendJobRunSafe` |
| `batch-job-execution-coordinator.ts` | Schedule append in `finally` |
| `admin-batch.routes.ts` | `GET /runs` + manual append |
| `job-run-cleanup-batch-job.ts` | Retention batch |
| `batch-recurring-schedules.ts` | `job_run_cleanup_batch` daily schedule |
| `jobs-panel-*.js` + `dashboard.html` | Timeline UI + disclaimer |

## Merge Opinion

**승인** — Phase 2 durable `job_run` 목표·계약·회귀·retention 요구를 충족합니다.

## Verification Commands (review run)

```bash
npm test -- \
  packages/memento-core/src/infrastructure/scheduler/repositories/job-run-repository.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/__tests__/batch-job-execution-coordinator.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/job-run-cleanup-batch-job.spec.ts \
  packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/044-job-run.spec.ts \
  packages/memento-server/src/server/dashboard-jobs-panel.spec.ts

npm test -- packages/memento-server/src/server/routes/admin.routes.spec.ts \
  -t "batch/status|batch/stats|batch/run-history|#833"
```
