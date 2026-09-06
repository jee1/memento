# Implementation Plan: Admin Jobs Dashboard Phase 3 — run logs + pause/resume·Run now

**Branch**: `feature/feat-admin-jobs-dashboard-phase-3-run-pause-resu` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/671-834-admin-jobs-dashboard-phase-3/spec.md`
**Issue**: [#834](https://github.com/jee1/memento/issues/834)
**Depends on**: [#833](https://github.com/jee1/memento/issues/833) Phase 2 (`job_run` migration 044) — CLOSED

## Summary

Phase 2 영속 `job_run` 위에 **run 로그**(`job_run_log` migration 046), **pause/resume**,
**Run now(전 등록 스케줄 job)** 를 admin API + Jobs UI에 노출한다. 이중 실행은
`isJobRunning` / JobQueue dedupe로 **409 Conflict**. 쓰기 액션은 admin auth + UI 확인 +
`ADMIN_JOBS_READ_ONLY` 미들웨어. **의도적 계약 확장**: `POST /admin/batch/run` 화이트리스트를
등록된 전 schedule job으로 확대(필드명 `jobType` 유지). P3 oldest-age는 optional.

## Technical Context

**Language/Version**: TypeScript 5.x, vanilla JS dashboard, Node.js ≥24  
**Primary Dependencies**: better-sqlite3, Express admin routes, BatchScheduler; no new deps  
**Storage**: SQLite `job_run_log` (migration **046**); parent `job_run` (044)  
**Testing**: Vitest — migration, JobRunLogRepository, job-control/runners, admin routes, jobs-panel UI  
**Target Platform**: Admin HTTP + MCP server DB  
**Project Type**: monorepo core persistence + scheduler + server routes + static UI  
**Performance Goals**: log list by run_id indexed; append O(1); cascade with retention  
**Constraints**: Constitution I TDD; II document `/batch/run` widen + keep GETs; III 046+schema.sql; IV gates+graphify; V log append soft-fail  
**Scale/Scope**: 1 table, GET logs, POST pause/resume, widen POST run, scheduler control expand, Jobs UI actions+Logs

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED repo/routes/control/UI before GREEN; dual-run 409 regression |
| Backward compatibility | II (MUST) | PASS | GETs `/status` `/stats` `/runs` `/run-history` unchanged; **POST `/batch/run` intentional widen** (allowlist → all registered schedule jobs; body `{ jobType }` kept). Document in contracts + CHANGELOG note at implement |
| Schema/migration | III (MUST) | PASS | `046-job-run-log` + `schema.sql` + indexes + FK cascade |
| Quality gates | IV (MUST) | PASS | lint, type-check, focused tests, graphify after production edits |
| Observability | V (SHOULD) | PASS | log append soft-fail (FR-010); does not flip job outcome |
| Additional Constraints | | PASS | Node 24; admin auth for writes; `ADMIN_JOBS_READ_ONLY` specified; no LoCoMo |

### Post-design re-check: PASS

## Project Structure

### Documentation (this feature)

```text
specs/671-834-admin-jobs-dashboard-phase-3/
├── plan.md / research.md / data-model.md / quickstart.md / tasks.md
├── contracts/admin-batch-phase3.md
├── checklists/requirements.md
├── progress.yml / spec.md
```

### Source Code (expected touch)

```text
packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/
  046-job-run-log.ts (+ spec)
packages/memento-core/…/schema.sql                          # mirror job_run_log
packages/memento-core/…/repositories/job-run-log-repository.ts (+ tests)
packages/memento-core/…/job-run-repository.ts               # deleteExpired cascade/order
packages/memento-core/…/batch-scheduler-job-runners.ts      # Manual* type + dispatch ↔ runners
packages/memento-core/…/batch-scheduler-job-control.ts      # pause/resume all interval jobs
packages/memento-core/…/batch-job-execution-coordinator.ts  # log buffer → flush after job_run
packages/memento-core/…/job-queue.ts                        # [P3 opt] enqueuedAt / oldest age
packages/memento-core/src/shared/config/…                   # ADMIN_JOBS_READ_ONLY
packages/memento-server/…/admin-batch.routes.ts             # GET logs, POST pause/resume, widen run
packages/memento-server/…/middleware or routes              # read-only reject on writes
static/js/jobs-panel-*.js + dashboard.html                  # Logs + pause/resume/Run/Retry + confirm
```

## Execution Strategy

- **TDD**: migration/log repo → append/flush hook → control expand → routes (logs/pause/resume/widen+409) → UI → retention cascade → (opt) P3.
- **Parallel**: UI after contract frozen; read-only middleware ∥ route tests once config wired.
- **AUTO-APPROVE**: Speckit plan/tasks; no commit/push.

## Complexity Tracking

없음 — 단일 자식 테이블·기존 stop/restart·run 표면 확장.  
주의: `restartJob`/`runManualBatchSchedulerJob` 현재 소수 타입만 처리 → registry 정렬이 핵심 설계(research.md).

## Intentional contract widen (POST /admin/batch/run)

| Before (Phase 1–2) | After (Phase 3) |
|--------------------|-----------------|
| Allow: `cleanup` \| `monitoring` \| `memory_review_candidates` | Allow: **all registered schedule job names** (runner/schedule registry) |
| Body: `{ "jobType": "<name>" }` | Body unchanged: `{ "jobType": "<name>" }` (Q2 “job” = identifier; wire field stays `jobType` for II) |
| Unknown → 400 | Unknown / unregistered → 400 |
| Busy dual-run | → **409 Conflict** (explicit; was implicit/error-prone) |

Sibling route **not** introduced (Q2).
