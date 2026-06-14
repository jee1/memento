# Zero-Downtime FTS5 Migration Strategy

## The Problem

SQLite's FTS5 virtual tables do not support `ALTER TABLE`. Adding a column — like `reflection_notes` (migration 006) — requires dropping and recreating the entire table. A naïve drop-and-recreate leaves a window where search returns no results. This document describes the strategy used to eliminate that window.

## Core Idea

Maintain two FTS5 tables simultaneously during the migration: the old one still serves search queries while the new one is built. Atomic swap happens only when the new table is fully populated.

The four-phase approach:

1. Create the new FTS5 table (`memory_item_fts_new`) with the new schema.
2. Backfill all existing `memory_item` rows into the new table (batched to limit I/O spikes).
3. Install dual triggers — writes go to both old and new tables concurrently, so no new records are missed.
4. Atomically drop the old table, rename the new one to `memory_item_fts`, swap the triggers.

## Phase 1 — Create New Table

```sql
CREATE VIRTUAL TABLE memory_item_fts_new USING fts5(
  content,
  tags,
  source,
  reflection_notes,
  content='memory_item',
  content_rowid='rowid'
);
```

Runs in a single transaction. Failure auto-rolls back; old table is untouched.

## Phase 2 — Backfill Existing Data

Rows are inserted in batches of 1,000 with a 10 ms pause between batches to limit impact on live queries:

```sql
INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
SELECT rowid, content, tags, source, reflection_notes
FROM memory_item
ORDER BY rowid
LIMIT ? OFFSET ?;
```

Each batch is its own transaction; a failure mid-backfill leaves the new table partially filled but the old table still serving queries.

## Phase 3 — Install Dual Triggers

While Phase 2 backfills historical data, new writes must go to both tables:

```sql
CREATE TRIGGER memory_item_fts_insert_new AFTER INSERT ON memory_item BEGIN
  INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
  VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
END;
-- UPDATE and DELETE triggers follow the same pattern
```

The original triggers continue writing to `memory_item_fts`. Both tables stay current until the swap.

## Phase 4 — Atomic Swap

In a single transaction:

1. Drop the original triggers.
2. Drop the dual triggers.
3. Drop `memory_item_fts`.
4. Rename `memory_item_fts_new` → `memory_item_fts`.
5. Create the new triggers (with `reflection_notes`) pointing to the renamed table.

Because this is a single transaction, there is no moment where neither FTS table exists.

## Rollback

| Phase | Rollback action |
|-------|----------------|
| 1 | `DROP TABLE IF EXISTS memory_item_fts_new` |
| 2 | Delete `memory_item_fts_new`; retry from scratch |
| 3 | `DROP TRIGGER IF EXISTS memory_item_fts_*_new` |
| 4 | Full transaction rollback; old table survives |

Phase 4 rollback is the most complex: the old table would need manual restoration from a backup. Prefer rolling back before reaching Phase 4.

## Migration State Machine

```
pending → in_progress → completed
              ↓
            failed → pending (retry)
```

State is stored in `memento_schema_version`. During `in_progress`, the search code falls back to `LIKE` queries for `reflection_notes` rather than FTS5.

## Performance Impact

| Phase | Expected overhead |
|-------|------------------|
| Backfill (Phase 2) | +10–20% search latency; +5–10% write latency |
| Dual triggers (Phase 3) | +5–10% write latency only |
| Swap (Phase 4) | < 1 second, no impact on reads |

For very large datasets: 100k rows ≈ 50 s, 1M rows ≈ 8 min during backfill.

## Lessons

This pattern generalizes to any FTS5 schema change in SQLite:
- Always build the new table alongside the old one.
- Dual triggers bridge the gap between backfill and swap.
- The swap transaction is the only moment of risk — keep it short.
- Track state in `memento_schema_version` so the app can degrade gracefully during migration.

For the full Korean version with detailed SQL rollback scripts and test scenarios, see [Korean version](../ko/zero-downtime-fts5-migration.md).
