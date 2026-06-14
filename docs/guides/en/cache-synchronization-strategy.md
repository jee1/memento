# CoreMemory cache synchronization strategy

CoreMemory caches items marked `always_load=true` in process memory so agents can access core information without a round-trip to SQLite on every call. This document describes how the cache stays consistent with the database and what limits apply in multi-instance deployments.

## Current design: single-server environment

Memento is designed around a single-server (single-process) model. The cache and the database live in the same process, so invalidation can be handled by comparing a version field rather than coordinating across network boundaries.

```
Application Layer
      ↓
CoreMemoryService ──→ CoreMemoryCache (In-Memory)
      ↓
CoreMemoryRepo (SQLite)
```

At server startup, all `always_load=true` items are pre-loaded into the cache. Subsequent `findByKey` calls check the cache first; if a miss occurs, the item is fetched from the database and, if `always_load=true`, added to the cache.

## Version-based invalidation

Every CoreMemory record carries a monotonically increasing `version` field. A record starts at `version = 1` when created and increments by one on every update.

When `findByKey` is called, three steps run in sequence:

1. Look up the cached entry (which stores the record, cached-at timestamp, and version).
2. Fetch the latest record from the database.
3. Compare versions. If the database version exceeds the cached version, the cache entry is invalidated and the fresh value is loaded. If versions match, the cached value is returned as-is. If the database version is somehow lower than the cached version, an anomaly warning is logged and the cached value is returned.

This makes cache invalidation automatic — any DB write that increments the version will be detected on the next read, without requiring an explicit invalidation signal.

## Explicit invalidation

Write operations — `update`, `updateByKey`, `delete`, `deleteByKey` — invalidate the relevant cache entry immediately after the DB write completes. For `always_load=true` items, the entry is also re-loaded from the database right away so the cache stays warm.

External code can subscribe to invalidation events through the cache's event listener API:

```typescript
cache.subscribeInvalidation({
  onInvalidate: (key, reason) => {
    // handle invalidation of a specific key
  },
  onInvalidateAll: (reason) => {
    // handle a full cache clear
  }
});
```

## Handling version=0

`version=0` indicates either an incomplete migration or an abnormal record state. Any cache entry with version 0 is unconditionally invalidated and a warning is logged. During server initialization a validation step checks that no `version=0` rows exist in the `core_memory` table:

```typescript
const zeroVersionCount = db.prepare(`
  SELECT COUNT(*) as count FROM core_memory WHERE version = 0
`).get() as { count: number };

if (zeroVersionCount.count > 0) {
  throw new Error('CoreMemory migration validation failed: version=0 rows exist');
}
```

Migration 010 introduced the `version` column and its associated index.

## Performance characteristics

Cache lookups use a JavaScript `Map`, giving O(1) access. The trade-off is that every `findByKey` still requires one DB query to compare versions. In practice, cache lookup and invalidation each run under 0.1 ms, while the version-comparison DB query adds roughly 1–5 ms.

If version-comparison overhead becomes a bottleneck, the most effective optimization is to split the version value into a separate lightweight table so only the version is queried rather than the full record.

## Distributed environment limitations

The current cache operates within a single process. When multiple server instances run simultaneously, a write on server A does not invalidate the cache on server B, which can lead to stale reads.

Three approaches exist for extending cache synchronization to distributed deployments.

**Pub/Sub messaging** publishes a cache-invalidation event when a DB change occurs; each server subscribes and invalidates its own cache. This provides real-time synchronization but requires an external broker such as Redis or RabbitMQ.

**Change Data Capture (CDC)** subscribes directly to the database change stream and updates caches accordingly. It preserves a DB-centric architecture but requires tooling such as Debezium.

**Polling-based synchronization** has each server periodically check for version mismatches. No additional infrastructure is required, but latency is higher and the approach adds steady-state DB load.

Memento currently targets single-server deployments. Distributed support can be added using any of the above patterns when the need arises.

## Reference

- CoreMemory service: `packages/memento-core/src/domains/memory/services/core-memory-service.ts`
- Cache service: `packages/memento-core/src/domains/memory/services/core-memory-cache-service.ts`
- Migration 010: `packages/memento-core/src/infrastructure/database/database/migration/migrations/010-add-core-memory-version.ts`
