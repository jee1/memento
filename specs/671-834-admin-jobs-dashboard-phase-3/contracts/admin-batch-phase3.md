# Contract: Admin batch Phase 3 — logs, pause/resume, Run now (widened)

**Auth**: same as other `/admin/batch/*` (admin API key / session).  
**Read-only**: when `ADMIN_JOBS_READ_ONLY=true`, all write routes below return **403** (GETs unchanged).

Base path: `/admin`

---

## 1. GET logs for a run

### `GET /batch/runs/:runId/logs`

| Query | Type | Default | Rules |
|-------|------|---------|-------|
| limit | int | 200 | clamp 1..500 |

**Alternative (acceptable if router prefers query-only):**  
`GET /batch/run-logs?runId=&limit=` — implement **one** of these; prefer path param to nest under runs.

### Response 200

```json
{
  "runId": "jr_…",
  "logs": [
    {
      "id": "jrl_…",
      "ts": "2026-09-06T12:00:00.100Z",
      "level": "info",
      "message": "cleanup started",
      "context": { "phase": "start" }
    }
  ],
  "limit": 200
}
```

- Order: `ts` ASC, then `id` ASC.
- Unknown `runId` → **404** `{ "error": "run not found" }` (not empty 200) so UI can distinguish.
- Known run, no lines → `{ "runId": "…", "logs": [], "limit": N }`.
- `context`: parsed JSON object if valid, else `null` (never 500 on bad JSON).

---

## 2. POST pause

### `POST /batch/pause`

Body:

```json
{ "jobType": "cleanup" }
```

### Response 200

```json
{
  "message": "배치 작업 cleanup 일시정지",
  "jobType": "cleanup",
  "paused": true,
  "timestamp": "…"
}
```

- Clears schedule interval; **does not** kill in-flight execution (Q6).
- Already paused / no interval → **200** idempotent (`paused: true`).
- Unknown jobType → **400**.

---

## 3. POST resume

### `POST /batch/resume`

Body:

```json
{ "jobType": "cleanup" }
```

### Response 200

```json
{
  "message": "배치 작업 cleanup 재개",
  "jobType": "cleanup",
  "paused": false,
  "timestamp": "…"
}
```

- Re-schedules via expanded restart registry.
- Already active → **200** idempotent.
- Config-disabled job (e.g. review candidates scheduler off) → **400** or **409** with clear message (prefer **400**); schedule unchanged.
- Unknown jobType → **400**.

---

## 4. POST Run now (widened)

### `POST /batch/run`

Body (unchanged field name):

```json
{ "jobType": "<registered_schedule_job_name>" }
```

### Intentional contract widen

| | Phase 1–2 | Phase 3 |
|---|-----------|---------|
| Allowed `jobType` | `cleanup` \| `monitoring` \| `memory_review_candidates` | **All registered schedule job names** (same set as Jobs status/stats schedules / runner registry) |
| Field | `jobType` | `jobType` (kept) |

Examples of newly allowed names (non-exhaustive): `healthcheck`, `triple_extraction_batch`, `log_rotation`, `telemetry_cleanup_batch`, `anchor_auto_refresh`, …

### Response 200

Same shape as today: `{ message, result, timestamp }` plus durable `job_run` append (`trigger=manual`) and log flush when buffer non-empty.

### Errors

| Status | When |
|--------|------|
| **400** | Missing/invalid/unregistered `jobType` |
| **401** / **403** | Auth failure (existing middleware) |
| **403** | `ADMIN_JOBS_READ_ONLY=true` |
| **409** | Job already running (`isJobRunning`) — dual-run guard; message stable e.g. `job already running` |
| **500** | Unexpected execution/DB errors (logger); soft-fail append must not alone cause 500 if job succeeded |

Pause + Run now: **allowed** (one-shot); schedule remains paused.

---

## 5. Errors summary (writes)

| Status | Meaning |
|--------|---------|
| 401 | Unauthenticated |
| 403 | Forbidden (auth scope **or** read-only mode) |
| 400 | Bad / unknown jobType; resume blocked by config |
| 409 | Conflict — concurrent Run now while busy |
| 404 | GET logs — unknown runId |
| 500 | Unexpected server/DB error |

---

## 6. Compatibility

- `GET /batch/status`, `/batch/stats`, `/batch/runs`, `/batch/run-history` — **backward compatible** (stats MAY add `paused` / P3 `oldestWaitingAgeMs` additively).
- Failed Retry (US4) — **no new route**; UI calls `POST /batch/run` with the row’s `jobName` as `jobType`.
