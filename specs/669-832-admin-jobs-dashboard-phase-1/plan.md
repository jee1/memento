# Implementation Plan: Admin Jobs Dashboard Phase 1

**Branch**: `feature/feat-admin-jobs-dashboard-phase-1-detailedstats` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/669-832-admin-jobs-dashboard-phase-1/spec.md`
**Issue**: [#832](https://github.com/jee1/memento/issues/832)

## Summary

기존 `BatchScheduler.getDetailedStats()` + `JobQueue` in-memory 상태를 **JSON-safe** Admin 읽기 API
`GET /admin/batch/stats`로 노출하고, Admin 대시보드에 **Jobs 탭**(스케줄 표·큐 요약·수동 run-history 임베드·Refresh only)을 추가한다.
`/admin/batch/status`·run-history·run 화이트리스트는 변경하지 않는다. DB/영속화 없음 (#833).

## Technical Context

**Language/Version**: TypeScript 5.x (core/server), vanilla JS (static dashboard), Node.js ≥24  
**Primary Dependencies**: Express 5 admin routes, existing `@memento/core` BatchScheduler; no new deps  
**Storage**: N/A (process-local in-memory only)  
**Testing**: Vitest — `admin.routes.spec.ts` / `admin-batch` route tests + `dashboard-jobs-panel.spec.ts` (vm harness like review-candidates)  
**Target Platform**: Admin HTTP dashboard  
**Project Type**: monorepo admin observability UI + API  
**Performance Goals**: O(n) over registered schedule jobs (dozens); snapshot copies of queue names  
**Constraints**: Constitution I TDD; II keep `/batch/status` unchanged; III N/A; IV lint/type-check/test + graphify; V safe empty/error JSON  
**Scale/Scope**: 1 new route handler path, JobQueue snapshot accessors, ~1 HTML panel + few static JS modules, route + UI smoke tests

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED: route stats JSON shape + JobQueue snapshot + Jobs panel smoke before impl |
| Backward compatibility | II (MUST) | PASS | New `/batch/stats` only; status/run-history/run unchanged |
| Schema/migration | III (MUST) | N/A | no DB |
| Quality gates | IV (MUST) | PASS | lint, type-check, focused tests, graphify after production edits |
| Observability | V (SHOULD) | PASS | existing logger on 500; empty scheduler → zeros |
| Additional Constraints | | PASS | Node 24 ESM; admin auth unchanged; no LoCoMo |

### Post-design re-check: PASS (no gate change)

## Project Structure

### Documentation (this feature)

```text
specs/669-832-admin-jobs-dashboard-phase-1/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/admin-batch-stats.md
├── checklists/requirements.md
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
packages/memento-core/src/infrastructure/scheduler/
├── job-queue.ts                          # getRunningNames / getQueuedNames (or snapshot)
└── batch-scheduler/
    ├── batch-scheduler-stats.ts          # optional enrich intervalMs; queue names in report
    └── batch-scheduler.ts                # wire if public API surface changes

packages/memento-server/src/server/routes/admin/
└── admin-batch.routes.ts                 # GET /batch/stats JSON-safe serializer

packages/memento-server/src/server/
├── admin.routes.spec.ts                  # or sibling batch stats tests
└── dashboard-jobs-panel.spec.ts          # NEW vm harness smoke

static/
├── dashboard.html                        # Jobs tab button + panel markup
├── js/
│   ├── dashboard-tabs-panels.js          # TAB_PANELS += jobs
│   ├── jobs-panel-shared.js              # URLs, formatters
│   ├── jobs-panel-render.js              # table/queue/history DOM
│   ├── jobs-panel-fetch.js               # manual refresh fetch
│   └── jobs-panel.js                     # boot / refresh wiring
└── css/ (tokens/dashboard as needed — minimal)
```

## Execution Strategy

- **TDD**: JobQueue snapshot unit → route contract → UI smoke (RED→GREEN).
- **Parallel**: core JobQueue/[P] vs server route after core green; UI after contract frozen.
- **Human checkpoint**: Speckit canonical auto-advance (user `진행해줘`); no commit/push.

## Complexity Tracking

없음 — 신규 경로·UI만; 외부 큐/영속화 도입 안 함.
