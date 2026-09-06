# Quickstart: Admin Jobs Dashboard Phase 3 (#834)

1. Migrate DB (server start / migrate) → `job_run` (044) + **`job_run_log` (046)** exist.
2. Run a schedule job or `POST /admin/batch/run` with `{ "jobType": "<registered>" }` (any registered schedule job, not only the old 3).
3. `GET /admin/batch/runs?job=<name>&limit=20` → pick a `id` (run id).
4. `GET /admin/batch/runs/:runId/logs` (or `?runId=` — see contract) → structured lines (may be empty).
5. Admin → Jobs tab → select run → **Logs** panel → Refresh.
6. **Pause** / **Resume** (confirm): schedule stops / restarts; in-flight run finishes; status shows paused.
7. **Run now** / failed-row **Retry** (confirm): one-shot manual run; if busy → **409**.
8. Read-only: set `ADMIN_JOBS_READ_ONLY=true` → GETs OK; POST pause/resume/run → **403**.
9. Retention: `JOB_RUN_RETENTION_DAYS` (default 90) deletes old `job_run` → logs cascade away.
10. (Optional P3) Stats/queue shows oldest waiting age when queue non-empty.
