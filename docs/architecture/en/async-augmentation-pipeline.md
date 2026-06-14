# Async Augmentation Pipeline (Issue #89)

## Overview

Conversations and events are **saved immediately without delay**; fact/triple extraction, consolidation scoring, deduplication, and quality measurement run in **background workers**. This "zero-latency write" design means agents never wait on enrichment.

## Immediate Write

When `remember` or `remember_procedure` is called:

- The memory is written to the DB **append-only**.
- The response is returned **immediately after the write**. No augmentation step (triple extraction, consolidation, etc.) is awaited.
- If the memory is episodic, `BatchScheduler.addJob()` registers a per-item triple extraction job in the queue before returning.

Implementation: `packages/memento-core/src/domains/memory/tools/remember-tool.ts` and `remember-procedure-tool.ts`.

## Background Refinement

The following jobs run via `BatchScheduler` on schedule or from the job queue:

| Job | Trigger | Role |
|-----|---------|------|
| Per-item triple extraction | Job queue (`addJob` from `remember`) | Extract triples from a single episodic memory immediately after save |
| `triple_extraction` batch | Every 1 hour | Catch any episodic memories not yet processed |
| `sleep_consolidation` | Every 1 hour | Distill episodic → semantic via `SleepConsolidationService` |
| `consolidation_score_incremental` | Every 1 hour | Incrementally update consolidation scores |
| `consolidation_score_full_sweep` | Daily (3 AM) | Full recalculation of all consolidation scores |
| `relation_validation` | Weekly (Sun 2 AM) | Validate relation graph integrity |
| `quality_measurement` | Daily | Measure memory quality metrics |
| `forgetting_cleanup` | Daily | Delete TTL-expired memories |

Reference files:
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler-default-config.ts`
- `packages/memento-core/src/workers/consolidation-score-worker.ts`

## Failure Retry and Monitoring

**Retry**
- Per-item queue jobs (triple extraction, etc.): `RetryManager` retries on failure. Configured via `BatchJobConfig.retryAttempts` and `retryDelay`.
- Triple extraction batch: on failure, `triple_extracted_status` is set to `'failed'` and `triple_extraction_metadata` records `retry_count` and `last_attempt`. The next batch sweep picks up failed items for retry.

**Monitoring**
- `BatchScheduler` logs to file and console. `getStatus()` returns queue size, running jobs, and last execution timestamps.
- When the HTTP server is running, admin routes expose scheduler state and queue for inspection.

## Scope Notes

- **Fact extraction**: Issue #88 normalized fact metadata. A dedicated "extract facts from conversation" step can be introduced as a separate job.
- **Summarization**: If an episode summarization service is added, it slots in the same JobQueue/batch pattern.
- **Deduplication**: Issue #90 (Triple/KG dedupe) coordinates with existing consolidation.
