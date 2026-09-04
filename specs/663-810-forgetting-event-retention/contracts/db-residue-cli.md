# DB Residue CLI Contract

## Entry

`npm run db:residue -- [subcommand] [options]`

## Subcommands

### `report`

Read-only JSON to stdout.

- `missing_minilm_semantic`: semantic `memory_item` without minilm row
- `duplicate_minilm_vectors`: groups with same embedding BLOB hash (minilm)
- `dimensions_zero`: rows with `dimensions = 0`

Sample IDs capped at 20.

### `cleanup-embeddings`

Default: preview (no DELETE).

`--apply`: DELETE `memory_embedding WHERE dimensions = 0` only.

Exit 0 on success; non-zero on validation error.

## Environment

- `DB_PATH`: required for CLI (absolute path in prod)

## VACUUM (separate)

`npm run db:vacuum` — after cleanup; outputs `{ before, after, reclaimed }`.
