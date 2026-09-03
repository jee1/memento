# Contract: memory_embedding BLOB storage (#809)

**Scope**: Internal SQLite persistence and vec index sync. **Out of scope**: MCP `recall`/`remember` response JSON shape (unchanged per Constitution II).

---

## C1. Column format

```
memory_embedding.embedding: BLOB
  = concat(float32_le(value[i]) for i in 0..dimensions-1)
```

- JSON text arrays **forbidden** on write after migration (FR-001).
- Endian: **little-endian only** (FR-019).

## C2. Validation at trust boundary (migrate + insert)

| Code | Condition | Action |
|------|-----------|--------|
| E001 | dimensions > 0 and byteLength ≠ dimensions×4 | reject row, rollback migration |
| E002 | any float is NaN or ±Inf | reject row, rollback |
| E003 | JSON parse failure on legacy row | rollback entire migration |
| E004 | legacy `[]` | dim=0, skip vec, count in report |

## C3. Public API stability (Principle II)

| Surface | Contract |
|---------|----------|
| MCP recall/remember | No new fields; no embedding raw bytes in tool responses |
| HTTP admin embedding map | Response JSON shape unchanged; values still number arrays |
| Search ranking | No weight/threshold change (#805/#806 out of scope) |

## C4. Vec index sync

| Event | Contract |
|-------|----------|
| INSERT/UPDATE memory_embedding | Triggers insert BLOB into matching vec tables (no json_extract) |
| DELETE | vec rowid removed |
| Post-migration cutover | Full repopulate + trigger recreate before serving traffic |

## C5. Rollback

Failed migration MUST leave live `memory_embedding` in **JSON TEXT** format with original row count (FR-015, SC-006).

## C6. Idempotency

Migration 043 on already-BLOB database: **no-op success** (skip rebuild, log `already_float32`).
