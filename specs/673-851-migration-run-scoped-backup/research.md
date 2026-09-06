# Research: Migration Run-Scoped Backup (#851)

## Decision: Run-scoped backup (not schema-change-only)

**Choice**: One `createBackup` per `runMigrations` invocation.  
**Why**: Issue primary proposal; measurable write reduction (N→1); simple.  
**Rejected**: Schema-change-only gating — ambiguous for data-only migrations;
most versions still change schema; deferred out of MVP (FR-010).

## Decision: Do not file-restore on mid-batch failure

**Choice**: Keep committed successful versions; SQL `ROLLBACK` + `down()` /
`removeVersion` for the failed version.  
**Evidence**:
- `rollbackMigration(migration, _backupPath)` ignores backup path (underscore);
  calls `down()` only — `migration-runner.ts` ~216–228.
- `findLatestBackup` / `restoreBackup` have no production callers (definitions +
  tests / nightly only).
**Rejected**: “Any failure restores pre-run snapshot” — would undo already
committed versions in the same batch (behavior change, worse than today).

## Decision: Filename may use first pending version

**Choice**: Pass first migration’s `version` into `createBackup` for naming
continuity (`memory-backup-${version}-…`).  
**Why**: Operators already grep by version prefix; one label ≠ N files.

## Decision: cleanup once per run

**Choice**: After the single create, call `cleanupBackups` once (same soft-fail
semantics as today).  
**Rejected**: Per-version cleanup — wasteful N scans when only one new file.

## Call sites

| Path | API | Notes |
|------|-----|-------|
| `init-migrate-existing.ts` | `runMigrations(..., { createBackup: true })` | inherits run-scope |
| `init-bootstrap-new-db.ts` | `runMigrations(..., { createBackup: true })` | inherits run-scope |
| Direct `runMigration` | tests / nightly | keep single-call backup |

## Residual risk

Operators who manually relied on mid-batch per-version files (unlikely;
retention already deletes most) see only pre-run snapshot — acceptable per issue.
