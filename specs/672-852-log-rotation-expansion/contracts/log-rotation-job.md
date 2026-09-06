# Contract: `log_rotation` batch job (expanded)

**Feature**: 672-852-log-rotation-expansion  
**Date**: 2026-09-06  
**Job type**: `log_rotation` (unchanged registry name)

## Invocation

Unchanged: recurring schedule via batch-scheduler / admin Run-now allowlist entry
`log_rotation`.

## Behavior

On run, the job MUST:

1. Resolve family roots (TE, migration, docker-diagnostics, log-issue-monitor).
2. Apply each family policy (age / keepCount / maxTotalBytes).
3. Soft-fail per file; continue other files/families.
4. Return `BatchJobResult` with `success: true` when orchestration completes without
   catastrophic setup failure (unreadable config is warning-level when families can still run).

## Result shape (additive)

Existing fields remain: `jobType`, `startTime`, `endTime`, `duration`, `success`,
`processed`, `errors`, `warnings`.

**Additive** `details` (optional object, JSON-serializable):

```ts
{
  retentionDaysTripleExtraction?: number;
  migrationKeepCount?: number;
  dockerDiagnosticsMaxBytes?: number;
  families?: Array<{
    family: 'triple_extraction' | 'migration' | 'docker_diagnostics' | 'log_issue_monitor';
    deletedCount: number;
    reclaimedBytes: number;
    skippedMissingRoot?: boolean;
  }>;
  reclaimedBytes?: number;
}
```

`processed` MUST equal total `deletedCount` across families (same meaning as today: files
removed; truncation of jsonl counts as 1 “processed” unit if content trimmed in place).

## Non-goals / prohibitions

- MUST NOT include absolute paths in `errors`, `warnings`, or `details`.
- MUST NOT delete `log-issue-monitor/state.json`.
- MUST NOT touch DB backup / quarantine trees.

## Env overrides (optional)

| Env | Default | Effect |
|-----|---------|--------|
| `LOG_ROTATION_MIGRATION_KEEP_COUNT` | `500` | `<=0` disables count cap |
| `LOG_ROTATION_DOCKER_DIAGNOSTICS_MAX_BYTES` | `268435456` | byte budget |
| `LOG_ROTATION_MONITOR_JSONL_MAX_BYTES` | `33554432` | per jsonl trim threshold |
| `LOG_ROTATION_TRIPLE_EXTRACTION_DAYS` | `30` | age days |
