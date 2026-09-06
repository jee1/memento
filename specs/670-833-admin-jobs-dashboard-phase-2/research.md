# Research: durable job_run (#833)

## Current state

- Manual only: `packages/memento-server/src/server/batch-run-history.ts` ring buffer (max 100).
- Schedule: `lastJobRunMeta` Map in execution coordinator — last-only, not durable.
- Phase 1 UI disclaimer: process-local until #833.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | SQLite `job_run` + migration 044 | Constitution III; matches telemetry |
| Schedule write | coordinator `finally` | Single path for all scheduled jobs |
| Manual write | POST `/batch/run` dual-write (+ optional runner) | Keeps ring buffer API (Q1) |
| Read API | `GET /admin/batch/runs` | Issue contract; newest-first |
| Retention | `JOB_RUN_RETENTION_DAYS` default 90 | Align `TELEMETRY_RETENTION_DAYS` |
| Cleanup | repo `deleteExpired` + call from telemetry_cleanup-adjacent or dedicated small job | ISO cutoff in JS (#810 lesson) |
| Ring buffer | Keep `/run-history` | Compat; UI timeline switches to `/runs` |

## Alternatives rejected

- Replace ring buffer immediately — breaks Review Candidates / Jobs embed consumers without migration window.
- File-based history — contradicts restart durability + query filters.
- Store only last run per job — fails “recent N” timeline SC.
