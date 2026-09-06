# Quickstart: durable job_run (#833)

1. Migrate DB (server start / migrate) → `job_run` exists.
2. Run any schedule job or `POST /admin/batch/run` (whitelist).
3. `GET /admin/batch/runs?limit=20` → see rows.
4. Admin → Jobs tab → select job → timeline from `/runs?job=…`.
5. Retention: set `JOB_RUN_RETENTION_DAYS` (default 90); cleanup deletes older `started_at`.
