# Data Model: Log Rotation Families

**Feature**: 672-852-log-rotation-expansion  
**Date**: 2026-09-06

## Entities

### LogFamilyId

Enum-like string union:

- `triple_extraction`
- `migration`
- `docker_diagnostics`
- `log_issue_monitor`

### RetentionPolicy

| Field | Type | Meaning |
|-------|------|---------|
| `retentionDays` | number \| null | Age cutoff; null = unused |
| `keepCount` | number \| null | Keep newest N; `<=0` disables count cap |
| `maxTotalBytes` | number \| null | Directory or artifact byte budget |
| `protectedBasenames` | string[] | Never delete (e.g. `state.json`) |

### LogFamilyPlan

| Field | Type | Meaning |
|-------|------|---------|
| `id` | LogFamilyId | Family key |
| `rootDir` | string | Resolved directory (runtime; not logged absolute to operators) |
| `policy` | RetentionPolicy | Effective policy |
| `match` | rule | Basename/glob predicate |

### FamilyRotationResult

| Field | Type | Meaning |
|-------|------|---------|
| `family` | LogFamilyId | |
| `deletedCount` | number | |
| `reclaimedBytes` | number | Best-effort sum of deleted sizes |
| `skippedMissingRoot` | boolean | |
| `warnings` | string[] | Basename-scoped messages only |

### LogRotationReport

| Field | Type | Meaning |
|-------|------|---------|
| `families` | FamilyRotationResult[] | |
| `deletedCount` | number | Sum |
| `reclaimedBytes` | number | Sum |
| `warnings` | string[] | Flattened |

## Selection rules

### migration

- Match: `/^migration_.*\.log$/`
- Sort: newest first by mtime (tie-break basename ASC for stability)
- Delete: index >= keepCount; optionally also age-expired even within keep set?  
  **Decision**: apply count cap first on full match set; optionally delete age-expired among
  remaining only if `retentionDays` set — MVP: count cap primary, age secondary on leftovers
  older than retentionDays.

### docker_diagnostics

- Match: files under root (non-directory)
- Sort: oldest mtime first for deletion candidates
- Delete while `sum(size) > maxTotalBytes`, preferring oldest; never delete if single remaining
  active file would still exceed budget alone (stop when one file left / or delete oldest until
  ≤ budget including allowing last oversized file only if alone — prefer delete oldest until
  ≤ budget or one file remains).

### log_issue_monitor

- Protect: `state.json`
- For `*.jsonl`: if size > max, truncate to tail max bytes (or rewrite last N bytes) soft-fail
  on lock; alternatively delete `*.jsonl.[0-9]` rotated copies first then truncate.

### triple_extraction

- Match: `*.log`
- Delete when `now - mtime > retentionDays`

## Validation

- Roots must pass existing path validation / stay under allowed bases.
- No entity persistence in SQLite.
