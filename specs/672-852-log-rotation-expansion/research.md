# Research: Expand log_rotation Beyond Triple-Extraction

**Feature**: 672-852-log-rotation-expansion  
**Date**: 2026-09-06

## R1 — Age-only retention fails under high churn

- **Decision**: Pair age rules with **count** (migration) and **byte** (diagnostics) caps.
- **Rationale**: #849 / PR #850 proved 30-day-only leaves all in-window surplus untouched.
  Issue #852 migration logs (~10k) show the same shape.
- **Alternatives considered**: Age-only with shorter window (still unbounded under burst);
  delete-all-on-boot (too destructive); external logrotate only (not in-process, easy to miss).

## R2 — Known families vs recursive `logs/` wipe

- **Decision**: Selector per family (TE, migration, docker-diagnostics, log-issue-monitor).
- **Rationale**: Spec Q1; recursive wipe risks operator files and unrelated tooling.
- **Alternatives considered**: `find logs -mtime` blanket delete — rejected as unsafe.

## R3 — Migration log root

- **Decision**: Primary root = `dirname(mementoConfig.dbPath)/logs` (`MigrationLogger`).
  Allow injected `migrationLogDir` in tests. Also accept files matching
  `migration_*.log` only.
- **Rationale**: Code writes there today; issue measurements under `~/.memento/logs` match
  when `dbPath` is `~/.memento/memory.db` or equivalent layout.
- **Alternatives considered**: Hard-code `~/.memento/logs` — brittle for custom `DB_PATH`.

## R4 — Defaults

| Family | Default | Override |
|--------|---------|----------|
| triple-extraction | age 30d | existing arg / shared constant |
| migration | keepCount **500** (+ optional age 30d secondary) | env `LOG_ROTATION_MIGRATION_KEEP_COUNT` |
| docker-diagnostics | maxTotalBytes **256 MiB** | env `LOG_ROTATION_DOCKER_DIAGNOSTICS_MAX_BYTES` |
| log-issue-monitor | preserve `state.json`; trim jsonl above **32 MiB** each (keep tail) or delete rotated siblings | env `LOG_ROTATION_MONITOR_JSONL_MAX_BYTES` |

- **Rationale**: Spec Q2–Q4; env mirrors backup `keepCount` override pattern without schema.
- **Alternatives considered**: keepCount=200 (backup-like) — migration logs are tiny; 500
  keeps more recent boot history. 128 MiB diagnostics — 256 MiB leaves headroom for active
  segments while far below 648 MiB failure case.

## R5 — Path leakage

- **Decision**: Reports use family id + basename + counts/bytes only.
- **Rationale**: AGENTS gotcha for backup cleanup; FR-007.
- **Alternatives considered**: Full paths in debug logs — rejected for operator-facing job result.

## R6 — Soft-fail semantics

- **Decision**: Per-file try/catch; family continues; job `success: true` if orchestrator
  completed; push unlink errors into `warnings` (or non-fatal `errors` only if entire family
  root unreadable — prefer warnings for partial).
- **Rationale**: Principle V; matches backup cleanup “one file fail does not block”.

## R7 — Collector-side docker diagnostics

- **Decision**: Optional supporting change: document total budget; consider lowering
  `DIAGNOSTICS_JSONL_RETAIN_FILES` default from 3→2 **or** leave writer unchanged and rely on
  scheduler byte budget (preferred MVP: scheduler enforces budget).
- **Rationale**: Writer rotation alone caused 648 MiB; job-side budget closes the gap even if
  writer misconfigured.

## R8 — CLI preview

- **Decision**: Out of MVP (spec Q6). Batch job is the growth control plane.
- **Alternatives considered**: `npm run logs:cleanup` preview/apply like db:backup:cleanup —
  useful later, not required to stop growth.
