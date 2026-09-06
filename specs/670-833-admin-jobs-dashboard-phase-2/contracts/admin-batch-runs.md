# Contract: GET /admin/batch/runs

**Auth**: same as other `/admin/batch/*` (admin API key / session).

## Request

| Query | Type | Default | Rules |
|-------|------|---------|-------|
| job | string | omit | if set, filter `job_name` exact |
| limit | int | 50 | clamp 1..100 |

## Response 200

```json
{
  "runs": [
    {
      "id": "…",
      "jobName": "cleanup",
      "trigger": "schedule",
      "startedAt": "2026-09-06T00:00:00.000Z",
      "endedAt": "2026-09-06T00:00:01.200Z",
      "success": true,
      "durationMs": 1200,
      "processed": 10,
      "errorCount": 0,
      "details": null
    }
  ],
  "limit": 50
}
```

- Order: `started_at` DESC.
- Empty → `{ "runs": [], "limit": N }`.
- `details`: parsed JSON object if valid, else null (never throw 500 on bad JSON).

## Errors

- 401/403: auth failure (existing middleware).
- 500: unexpected DB errors (logger).
