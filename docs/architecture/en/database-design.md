# Database Design

**Purpose**: Single design specification for the Memento MCP Server SQLite schema — table and column roles, naming conventions, indexes, constraints, and migration history.

**Note**: The canonical executable DDL is `packages/memento-core/src/infrastructure/database/database/schema.sql` plus migration scripts. This document is explanatory.

**Related**: [Migration system guide](../../guides/en/migration-system-guide.md), [Full table ERD](../ko/database-erd.md).

---

## 1. Overview

Memento uses an embedded SQLite database. The schema started as a simple personal memory store (M1) and has expanded to cover MIRIX fields, the relation engine, context anchors, multi-embedding support, multi-agent ownership, KG triples, and telemetry.

Key conventions:
- **Single-document policy**: `schema.sql` + numbered migrations (002–) are the authoritative DDL. This file explains intent and history; the DDL is the truth.
- **Timestamp timezone**: Store all times in the DB in **UTC**. Use ISO 8601 with a `Z` suffix or `strftime('%Y-%m-%dT%H:%M:%fZ','now')`. Convert to local time only for display.
- **Soft delete**: Logical deletion uses `is_deleted = TRUE` + `deleted_at`. A hard delete can follow later.

---

## 2. Core Tables

### `memory_item`

The single table for all memory types. One row = one memory.

Notable columns:

| Column | Description |
|--------|-------------|
| `id` | UUID primary key |
| `type` | `working` / `episodic` / `semantic` / `procedural` |
| `content` | Memory text |
| `importance` | Float 0–1 |
| `pinned` | Excluded from forgetting |
| `tags` | JSON array |
| `owner_id` | Agent or user identity (multi-agent isolation) |
| `project_id` | Project-scoped memory |
| `version` / `version_series_id` | Procedural memory versioning |
| `subject` / `predicate` / `object` | Semantic triple fields |
| `triple_extracted` / `triple_extracted_status` | Triple extraction state for async pipeline |
| `consolidation_score` / `g_value` | Consolidation scoring |
| `recall_count` / `last_accessed_at` | Usage statistics |
| `is_deleted` / `deleted_at` | Soft delete |
| `process_id` / `session_id` | Memori attribution (Issue #87) |

Procedural-specific columns: `task_goal`, `steps` (JSON array), `reflection_notes`, `workflow_name`, `skill_name`, `trigger_conditions`.

### `memory_tag` / `memory_item_tag`

Normalized N:M tag relationship. `memory_tag` holds distinct tag names; `memory_item_tag` is the join table.

### `memory_link`

Explicit typed relationships between memories.

| Column | Values |
|--------|--------|
| `relation_type` | `cause_of`, `derived_from`, `duplicates`, `contradicts`, `version_of` |
| `source_id` / `target_id` | Foreign keys to `memory_item` |

### `memory_embedding`

Stores vector embeddings. Multiple providers and dimensions are supported per memory. Used by sqlite-vec for ANN search.

### `memory_item_fts` (virtual table)

FTS5 full-text search index over `content`, `tags`, `source`. Content table is `memory_item`.

### `memory_anchor`

Persistent context anchors. Slots A/B/C per agent (`owner_id`). Restored automatically on server restart.

### `meta_memory_stats`

Per-memory recall statistics: `recall_count`, `success_count`, `failure_count`, `avg_confidence`. Fed by `MetaMemoryService` and read by `MetaMemoryIntrospectionService`.

### `kg_triple`

Deduplicated knowledge-graph triples extracted from episodic memories. Separate from the inline `subject`/`predicate`/`object` columns on `memory_item` to support cross-memory deduplication (migration 018–019).

### `memory_relation` / `relation_type_registry`

Relation engine tables (migration 005). `memory_relation` stores typed directed edges; `relation_type_registry` holds the catalogue of valid relation types.

### Telemetry tables

`telemetry_events` and `telemetry_daily_metrics` track per-agent tool usage patterns for `TelemetryService`. (migration 027–028)

---

## 3. Indexes

Critical indexes on `memory_item`:

| Index | Columns | Condition |
|-------|---------|-----------|
| `idx_memory_item_is_deleted_active` | `is_deleted` | `is_deleted = 0` |
| `idx_memory_item_triple_extracted_episodic` | `triple_extracted` | `type = 'episodic'` |
| `idx_memory_item_triple_extracted_status_episodic` | `triple_extracted_status` | `type = 'episodic'` |
| `idx_memory_item_project_id_type` | `project_id, type` | `project_id IS NOT NULL` |
| `idx_memory_item_triple` | `subject, predicate, object` | `type='semantic' AND subject IS NOT NULL ...` |

Partial indexes on `type = 'episodic'` keep the triple extraction pipeline fast even as the table grows.

---

## 4. Migrations

Migration files live in `packages/memento-core/src/infrastructure/database/database/migration/migrations/`. Each file is numbered (e.g., `002_`, `003_`...) and runs once. The `MigrationHistoryService` tracks which have been applied.

Run pending migrations with:
```bash
npm run db:migrate
```

---

## 5. WAL and Maintenance

- **WAL mode** is enabled for concurrent read access.
- `WalCheckpointScheduler` periodically flushes the WAL to the main database file.
- `DatabaseLockMonitor` logs lock contention events.
- `DatabaseOptimizer` runs `ANALYZE` and index optimization on a schedule.
