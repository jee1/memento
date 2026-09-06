# Data Model: job_run

## Table `job_run`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | uuid / nanoid |
| job_name | TEXT NOT NULL | schedule name or manual jobType |
| trigger | TEXT NOT NULL | `schedule` \| `manual` |
| started_at | TEXT NOT NULL | ISO 8601 |
| ended_at | TEXT NOT NULL | ISO 8601 |
| success | INTEGER NOT NULL | 0/1 |
| duration_ms | INTEGER NOT NULL | |
| processed | INTEGER | nullable / default 0 |
| error_count | INTEGER | nullable / default 0 |
| details_json | TEXT | nullable JSON |

## Indexes

- `idx_job_run_job_started` ON `(job_name, started_at DESC)`
- `idx_job_run_started` ON `(started_at)` — retention scans

## Config

- `JOB_RUN_RETENTION_DAYS` — number ≥ 1, default **90**

## Mapping

| Source | Field |
|--------|-------|
| BatchJobResult | processed, errors.length → error_count, details → details_json |
| schedule void runner | processed/error_count may be 0; success/duration from finally |
| BatchRunHistoryRecord | parallel manual shape for ring buffer only |
