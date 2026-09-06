# Data Model: job_run_log

Parent: Phase 2 `job_run` (migration 044). Child logs live only while the parent run exists.

## Table `job_run_log` (migration **046**)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | uuid / nanoid (`jrl_…`) |
| run_id | TEXT NOT NULL | FK → `job_run(id)` **ON DELETE CASCADE** |
| ts | TEXT NOT NULL | ISO 8601 |
| level | TEXT NOT NULL | `debug` \| `info` \| `warn` \| `error` (CHECK) |
| message | TEXT NOT NULL | human-readable; recommend ≤ 2 KiB (truncate if larger) |
| context_json | TEXT | nullable JSON object as text; size cap (recommend ≤ 16 KiB, truncate) |

## Indexes

- `idx_job_run_log_run_ts` ON `(run_id, ts ASC, id ASC)` — chronological list per run
- (PK on `id` sufficient for single-row ops)

## DDL (normative sketch)

```sql
CREATE TABLE IF NOT EXISTS job_run_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  context_json TEXT,
  FOREIGN KEY (run_id) REFERENCES job_run(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_run_log_run_ts
  ON job_run_log(run_id, ts ASC, id ASC);
```

## Retention (FR-011)

- Parent `JobRunRepository.deleteExpired` deletes expired `job_run` rows → **CASCADE** removes child logs.
- If FK unavailable in a test harness without PRAGMA foreign_keys: repository must delete logs for expired run ids explicitly (defense in depth optional; production enables FK).

## Repository API (planned)

| Method | Behavior |
|--------|----------|
| `append(db, { run_id, ts, level, message, context_json? })` | single insert |
| `appendMany(db, run_id, lines[])` | batch; soft-fail at call site |
| `listByRunId(db, run_id, { limit? })` | chronological ASC; limit clamp 1..500 default 200 |
| (optional) `deleteByRunId` | tests / non-FK envs |

## Mapping

| Source | Field |
|--------|-------|
| LogBuffer line | ts, level, message, context → context_json |
| `job_run.id` after append | run_id |
| UI / GET | camelCase: `runId`, `ts`, `level`, `message`, `context` (parsed JSON or null) |

## Config

| Env | Default | Notes |
|-----|---------|-------|
| `ADMIN_JOBS_READ_ONLY` | false | write reject (not retention) |
| `JOB_RUN_RETENTION_DAYS` | 90 | unchanged; cascades to logs |

## Non-schema

- No change to `job_run` columns required for MVP (completed-only rows + post-hoc log flush).
- P3 queue oldest-age is **not** a DB entity (in-memory JobQueue field).
