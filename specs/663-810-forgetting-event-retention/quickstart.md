# Quickstart: #810 DB retention & residue

## 1. Report (read-only)

```bash
DB_PATH=/path/to/memento.db npm run db:residue -- report
```

## 2. Remove dimensions=0 embeddings

```bash
# preview
DB_PATH=/path/to/memento.db npm run db:residue -- cleanup-embeddings

# apply
DB_PATH=/path/to/memento.db npm run db:residue -- cleanup-embeddings --apply
```

Verify: `SELECT COUNT(*) FROM memory_embedding WHERE dimensions = 0` → 0

## 3. Retention batch (server)

Set optional env:

```bash
FORGETTING_EVENT_RETENTION_DAYS=90
FORGETTING_EVENT_CLEANUP_INTERVAL_MS=86400000
```

Scheduler runs `forgetting_event_cleanup_batch` daily.

## 4. VACUUM (after deletes)

```bash
DB_PATH=/path/to/memento.db npm run db:vacuum
```

Order: retention/cleanup → VACUUM → measure size.

## 5. Tests

```bash
npm test -- packages/memento-core/src/domains/forgetting \
  packages/memento-core/src/infrastructure/scheduler/jobs/forgetting-event-cleanup-batch-job.spec.ts \
  scripts/db-residue-cleanup.spec.ts
```
