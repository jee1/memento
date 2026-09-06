# Implementation Plan: Admin Jobs Dashboard Phase 2 — durable job_run

**Branch**: `feature/feat-admin-jobs-dashboard-phase-2-durable-job_ru` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/670-833-admin-jobs-dashboard-phase-2/spec.md`
**Issue**: [#833](https://github.com/jee1/memento/issues/833)

## Summary

SQLite `job_run`에 스케줄·수동 배치 실행을 영속화하고, `GET /admin/batch/runs` + Jobs UI
타임라인으로 최근 N회를 조회한다. ring buffer `/run-history`는 보조 유지.
Retention: `JOB_RUN_RETENTION_DAYS` 기본 90 + `deleteExpired` (telemetry 패턴).

## Technical Context

**Language/Version**: TypeScript 5.x, vanilla JS dashboard, Node.js ≥24  
**Primary Dependencies**: better-sqlite3, Express admin routes, BatchScheduler; no new deps  
**Storage**: SQLite `job_run` (migration 044+)  
**Testing**: Vitest — repository, migration validate, admin routes, jobs-panel UI smoke  
**Target Platform**: Admin HTTP + MCP server DB  
**Project Type**: monorepo core persistence + server routes + static UI  
**Performance Goals**: indexed list by job/time; append O(1); retention DELETE by cutoff  
**Constraints**: Constitution I TDD; II keep status/stats/run-history/run whitelist; III migration+schema.sql; IV gates+graphify; V append soft-fail  
**Scale/Scope**: 1 table, 1 GET, coordinator+route append, retention hook, Jobs UI timeline

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED repo/routes/UI/retention before GREEN |
| Backward compatibility | II (MUST) | PASS | New `/runs`; existing batch routes unchanged contracts |
| Schema/migration | III (MUST) | PASS | 044-job-run + schema.sql + indexes |
| Quality gates | IV (MUST) | PASS | lint, type-check, focused tests, graphify |
| Observability | V (SHOULD) | PASS | append failure logged; job outcome not flipped |
| Additional Constraints | | PASS | Node 24; admin auth; no LoCoMo |

### Post-design re-check: PASS

## Project Structure

### Documentation (this feature)

```text
specs/670-833-admin-jobs-dashboard-phase-2/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/admin-batch-runs.md
├── checklists/requirements.md
├── progress.yml / spec.md / tasks.md
```

### Source Code (expected touch)

```text
packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/
  044-job-run.ts
packages/memento-core/src/infrastructure/database/… schema.sql
packages/memento-core/…/job-run-repository.ts (+ tests)
packages/memento-core/…/batch-job-execution-coordinator.ts  # schedule append
config: JOB_RUN_RETENTION_DAYS + cleanup hook
packages/memento-server/…/admin-batch.routes.ts             # GET /runs + manual append
static/js/jobs-panel-*.js + dashboard.html                  # timeline + disclaimer
```

## Execution Strategy

- **TDD**: migration/repo → coordinator/route append → GET /runs → UI → retention.
- **Parallel**: UI after contract frozen; retention tests ∥ route once repo green.
- **AUTO-APPROVE**: Speckit canonical; no commit/push.

## Complexity Tracking

없음 — 단일 테이블·표준 마이그레이션·기존 Jobs 패널 확장.
