# Data Model: Admin Jobs Dashboard Phase 1

**Date**: 2026-09-06  
**Storage**: none (HTTP JSON views over in-memory scheduler)

## Entities (API views)

### SchedulerHealthView

| Field | Type | Notes |
|-------|------|-------|
| memoryUsage | number | heapUsed/heapTotal % |
| runningJobs | number | queue.runningCount |
| queueSize | number | queue.size |
| errorRate | number | 0..1 |
| uptime | number | ms |

### ScheduleJobView

| Field | Type | Notes |
|-------|------|-------|
| name | string | interval registry key |
| intervalMs | number \| null | from config map when known |
| enabled | boolean | true if registered in intervals |
| lastExecution | string \| null | ISO 8601 |
| totalExecutions | number | |
| errorCount | number | |
| errorRate | number | |
| isRunning | boolean | |

### QueueSnapshot

| Field | Type | Notes |
|-------|------|-------|
| size | number | |
| runningCount | number | |
| runningNames | string[] | copy |
| queuedNames | string[] | copy of queued job names |

### BatchStatsResponse

| Field | Type | Notes |
|-------|------|-------|
| message | string | |
| health | SchedulerHealthView | |
| jobs | ScheduleJobView[] | |
| queue | QueueSnapshot | |
| schedulerRunning | boolean | from detailedStats.status.isRunning if available without Maps |
| timestamp | string | ISO |

### ManualRunHistoryEntry

Unchanged — existing process-local ring buffer via `/admin/batch/run-history`.

## Relationships

```text
BatchScheduler --getDetailedStats--> health + jobs
BatchScheduler.jobQueue --snapshot--> queue
Admin UI --fetch--> BatchStatsResponse + ManualRunHistoryEntry[]
```

## Validation / invariants

- All arrays present (may be empty); never `undefined` for required keys.
- No `Date` / `Map` in JSON body.
- Failure: HTTP 500 `{ error, message }` without absolute paths.
