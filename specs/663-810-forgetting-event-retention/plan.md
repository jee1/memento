# Implementation Plan: memory_forgetting_event 보존 정책 및 DB 잔재 정리

**Branch**: `663-810-forgetting-event-retention` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)
**Issue**: [#810](https://github.com/jee1/memento/issues/810)

## Summary

`memory_forgetting_event`에 90일(설정 가능) 시간 기반 retention 배치 잡을 추가하고,
운영자용 `db:residue` CLI로 `dimensions=0` 임베딩 삭제(preview/apply) 및 임베딩
갭·중복 벡터 read-only 리포트를 제공한다. `TelemetryCleanupBatchJob`·
`deleteExpiredEvents` 패턴을 따른다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules
**Primary Dependencies**: better-sqlite3, batch-scheduler, @memento/core
**Storage**: SQLite (`memory_forgetting_event`, `memory_embedding`)
**Testing**: Vitest (domain + scheduler job + CLI script specs)
**Target Platform**: memento-server MCP + operator CLI
**Performance Goals**: retention DELETE 단일 쿼리; non-blocking batch failure
**Constraints**: ISO cutoff only; no MCP contract change; no auto VACUUM
**Scale/Scope**: ~56k forgetting events post-#804; 4 dimensions=0 rows

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED tests for repository delete, batch job, CLI |
| Backward compatibility | II (MUST) | PASS | Internal retention; MCP unchanged |
| Schema/migration | III (MUST) | N/A | No schema change; DELETE only |
| Quality gates + graphify | IV (MUST) | PASS | lint/type-check/test; graphify after prod code |
| Observability | V (SHOULD) | PASS | logger + batch result details |
| Additional Constraints | — | PASS | Node 24, no prod DB commit |

## Project Structure

### Documentation (this feature)

```text
specs/663-810-forgetting-event-retention/
├── spec.md
├── plan.md
├── tasks.md
├── progress.yml
├── research.md
├── quickstart.md
├── data-model.md
├── contracts/
│   └── db-residue-cli.md
└── checklists/
```

### Source Code

```text
packages/memento-core/src/
├── domains/forgetting/repositories/forgetting-event-repository.ts  # deleteExpiredEvents
├── infrastructure/scheduler/jobs/forgetting-event-cleanup-batch-job.ts
├── infrastructure/scheduler/handlers/batch-scheduler-forgetting-cleanup-handlers.ts
├── infrastructure/scheduler/batch-scheduler/batch-scheduler-types.ts  # interval config
scripts/
├── db-residue-cleanup.ts          # preview/apply dimensions=0 + report
└── db-vacuum.ts                   # optional thin wrapper if missing

tests via *.spec.ts colocated
```

## Phase 0: Research

See [research.md](./research.md).

## Phase 1: Design

- **Repository**: `ForgettingEventRepository.deleteExpiredEvents(retentionDays)` —
  `cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()`;
  `DELETE FROM memory_forgetting_event WHERE created_at < ?`
- **Batch job**: `ForgettingEventCleanupBatchJob` mirrors `TelemetryCleanupBatchJob`;
  env `FORGETTING_EVENT_RETENTION_DAYS` default 90; interval
  `FORGETTING_EVENT_CLEANUP_INTERVAL_MS` default 24h.
- **Scheduler wiring**: register in `batch-recurring-schedules.ts`, handler, context,
  default config, validate config.
- **CLI**: `npm run db:residue` — subcommands `report`, `cleanup-embeddings`
  (--apply); report sections: missing_minilm_semantic, duplicate_minilm_vectors,
  dimensions_zero_count.
- **VACUUM**: reuse `vacuumAndMeasure` from quarantine-run or add `scripts/db-vacuum.ts`.

## Phase 2: Execution Strategy

| Phase | Focus | TDD | Parallel |
|-------|-------|-----|----------|
| 1 | Repository + unit tests | Yes | — |
| 2 | Batch job + scheduler wiring | Yes | [P] config/types |
| 3 | CLI report + cleanup | Yes | [P] docs |
| 4 | Polish: env.example, quickstart, review | — | — |

## Complexity Tracking

No constitution violations.
