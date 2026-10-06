# Asynchronous Augmentation Pipeline (Issue #89)

Waiting for relation extraction and consolidation on every `remember` call would inflate latency. This pipeline **persists the memory first**, then hands relation extraction, summarization, deduplication, and consolidation scoring to **`BatchScheduler` background workers**. The MCP response returns as soon as the row is safely written; slower work continues via the job queue and cron schedules.

## Overview

> **Removed (#1237, 2026-10-03)** — Triple extraction, `extract_triples`, and the `kg_triple` schema were removed (#1230, #1235).

The sections below describe the immediate save path, follow-up jobs, and retry/monitoring behavior.

## Immediate save

- On **remember / remember_procedure**:
  - Append the memory row to the database.
  - Return the response **immediately** without waiting for augmentation (relation extraction, consolidation, etc.).
- Implementation: `remember-tool.ts` and `remember-procedure-tool.ts` return after a successful DB write. `launchBackgroundAugmentation` registers relation extraction jobs via `BatchScheduler.addJob()`.

## Background refinement

These jobs run through **BatchScheduler** (queue and/or cron):

| Job | Trigger | Role |
|-----|---------|------|
| Per-item relation extraction | JobQueue (`addJob` from remember-tool) | Enqueued right after episodic save |
| `sleep_consolidation` | Every hour | Episodic → semantic distillation (`SleepConsolidationService`) |
| `quality_measurement` | Every 24h | Memory quality measurement |
| `forgetting_cleanup` | Every 24h | TTL-expired memory cleanup |
| `memory_review_candidates` | Every 24h | Spaced-repetition review queue refresh |

Reference files:
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
- `packages/memento-core/src/workers/consolidation-score-worker.ts`

## Retry and monitoring

- **Retry**
  - Queued jobs (per-item relation extraction, etc.): `RetryManager` retries on failure using `BatchJobConfig.retryAttempts`, `retryDelay`, and related settings.
- **Monitoring**
  - BatchScheduler logs (file/console), `getStatus()` for queue size, running jobs, and last run timestamps.
  - With the HTTP server, admin routes expose scheduler status and queue depth.

## Scope notes

- **Fact extraction**: Issue #88 normalized Fact metadata; a dedicated Fact extraction stage may arrive in a future issue.
- **Summarization**: If episodic summarization becomes a separate service, it should register on the same JobQueue/batch path.
- **Dedupe**: Issue #90 and existing consolidation integration.
