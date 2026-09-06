# Contract: `GET /admin/batch/stats`

**Auth**: same as other Admin batch routes  
**Method/Path**: `GET /admin/batch/stats`  
**Side effects**: none (read-only)

## 200 Response

```json
{
  "message": "배치 스케줄러 상세 통계 조회 완료",
  "schedulerRunning": true,
  "health": {
    "memoryUsage": 42.5,
    "runningJobs": 1,
    "queueSize": 2,
    "errorRate": 0.01,
    "uptime": 3600000
  },
  "jobs": [
    {
      "name": "cleanup",
      "intervalMs": 3600000,
      "enabled": true,
      "lastExecution": "2026-09-06T08:00:00.000Z",
      "totalExecutions": 12,
      "errorCount": 0,
      "errorRate": 0,
      "isRunning": false
    }
  ],
  "queue": {
    "size": 2,
    "runningCount": 1,
    "runningNames": ["monitoring"],
    "queuedNames": ["cleanup", "log_rotation"]
  },
  "timestamp": "2026-09-06T08:30:00.000Z"
}
```

## Rules

- MUST NOT include nested `Map` / raw `Date` values.
- MUST NOT change `GET /admin/batch/status` response.
- Empty scheduler: `jobs: []`, queue zeros, `schedulerRunning: false` (or true with empty jobs if running but no intervals — match runtime).

## Errors

| Status | Body |
|--------|------|
| 401/403 | existing admin auth behavior |
| 500 | `{ "error": "...", "message": "..." }` |

## Related (unchanged)

- `GET /admin/batch/run-history?limit=`
- `POST /admin/batch/run` whitelist: `cleanup` \| `monitoring` \| `memory_review_candidates`
