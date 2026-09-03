# Phase 1 Data Model: 임베딩 JSON → Float32 BLOB (#809)

**Date**: 2026-09-01 | **Plan**: [plan.md](./plan.md)

## 1. memory_embedding (persisted)

| Field | Type (after) | Rules |
|-------|--------------|-------|
| id | INTEGER PK | unchanged |
| memory_id | TEXT FK | unchanged |
| embedding_provider | TEXT | unchanged |
| projection_type | TEXT | default `native` |
| **embedding** | **BLOB** | float32 LE, length = dimensions × 4. **Not** JSON text |
| dim | INTEGER | source dimension |
| dimensions | INTEGER | stored dimension; 0 allowed for empty `[]` legacy |
| model | TEXT | optional |
| precision | INTEGER | **32** for float32 rows |
| normalized | BOOLEAN | 1 iff \|L2 norm − 1\| < 1e−5 |
| version | INTEGER | unchanged |
| created_by | TEXT | new inserts: `memory_embedding_service` |
| created_at | TIMESTAMP | unchanged |

**Validation (migration + write)**:
- V1: `dimensions > 0` ⇒ `embedding.byteLength === dimensions * 4`
- V2: decoded floats contain no NaN/Inf
- V3: JSON legacy `[]` ⇒ dimensions=0, embedding NULL or zero-length policy per FR-018 (skip vec)

**State transition**: JSON TEXT ──(043 migration)──► BLOB float32 (atomic). Failure rolls back to JSON.

## 2. Embedding BLOB (value object)

| Property | Value |
|----------|-------|
| Encoding | IEEE754 float32, **little-endian** |
| Empty | dimensions=0, no vec index row |
| Semantic equality | Same float sequence after JSON round-trip (bitwise float32) |

**Operations**:
- `encodeFloat32Embedding(numbers: number[]): Buffer`
- `decodeFloat32Embedding(blob: Buffer): Float32Array`
- `migrateJsonEmbeddingToBlob(json: string): { blob: Buffer \| null; dimensions: number }`

## 3. memory_item_vec_* (virtual index)

| Property | Rule |
|----------|------|
| rowid | = `memory_embedding.id` |
| embedding | BLOB from parent row (direct, no json_extract) |
| filter | per `VEC_TABLES[].predicates` — dimensions=0 excluded |

**Invariant (SC-004)**: ∀ table ∈ VEC_TABLES: `COUNT(vec WHERE filter)` = `COUNT(memory_embedding WHERE filter)`

## 4. Migration transaction (atomic unit)

```
BEGIN
  DROP vec triggers
  CREATE memory_embedding__new (embedding BLOB ...)
  INSERT ... SELECT (JSON→BLOB per row, validate)
  DROP memory_embedding
  RENAME __new → memory_embedding
COMMIT
-- outside txn:
  repopulate all vec tables
  recreateVecTriggers
  VACUUM (optional, for SC measurement)
```

## 5. Runtime read model (in-memory)

| Consumer | Field | Type after decode |
|----------|-------|-------------------|
| Search / recall | vector | `number[]` or Float32Array view |
| Admin map | coordinates | `number[]` (HTTP JSON unchanged) |
| Anchor / neighbor | embedding | `number[]` |

**Rule**: No JSON.parse on `embedding` column after cutover (FR-021).

## 6. Migration report (ephemeral log)

| Metric | Purpose |
|--------|---------|
| rows_migrated | total copied |
| rows_skipped_empty | `[]` count (SC-009) |
| rows_rejected | NaN/Inf/dim mismatch (should trigger rollback) |
| duration_ms | ops telemetry |

No absolute DB paths in logs (AGENTS.md).
