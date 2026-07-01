# Implementation Plan: 036-scheduler-orchestrator-split

## Architecture

`BatchScheduler`(909줄)과 `TripleExtractionBatchJob`(865줄) god node를 **composition**으로 분해한다. Public import 경로와 class export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
batch-scheduler.ts                     # 오케스트레이션
batch-scheduler/
  batch-scheduler-logging.ts
  batch-scheduler-context.ts
  batch-scheduler-diagnostics.ts
  batch-scheduler-interval.ts
  batch-scheduler-stats.ts
  batch-scheduler-health.ts
  batch-scheduler-singleton.ts

triple-extraction-batch-job.ts         # execute() 파이프라인 오케스트레이션
triple-extraction-batch-job/
  triple-extraction-batch-job.types.ts
  triple-extraction-batch-job-retry.ts
  triple-extraction-batch-job-chunk.ts
  triple-extraction-batch-job-memory-status.ts
```

## Changes

| 파일 | 변경 |
|------|------|
| `batch-scheduler/*.ts` | 신규 — 스케줄러 책임 분리 |
| `batch-scheduler.ts` | 축소 — delegate only |
| `triple-extraction-batch-job/*.ts` | 신규 — Triple 추출 배치 책임 분리 |
| `triple-extraction-batch-job.ts` | 축소 — execute() pipeline only |
| `triple-extraction-batch-job.types.ts` | `BatchJobResult` → `batch-scheduler-types.js` |

## Test Strategy

- 선행: batch-scheduler·triple-extraction vitest baseline green 확인
- 분리 후: 동일 spec 재실행 (anchor auto-refresh, recurring jobs, retry policy 포함)
- 전체: `npm run build && npm run lint && npm run type-check`

## Constitution Alignment

- Structural refactoring exception: CI green = regression signal
- Backward compatibility: import path·public API 유지
- Mechanical extraction only — no behavior changes
