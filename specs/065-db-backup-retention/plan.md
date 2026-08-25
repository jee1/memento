# Implementation Plan: Database Backup Retention and Artifact Cleanup

**Branch**: `jee1/chore-db-backups-6-900-5.5gb-0-sidecar` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/065-db-backup-retention/spec.md`

## Summary

Strengthen the existing `BackupManager` instead of adding a new backup service. Both automatic
migration backups and the existing operator command will use `better-sqlite3`'s online backup API,
write to a uniquely named in-progress file, validate snapshot-derived byte size plus full SQLite
integrity, remove attempt sidecars, and publish without overwriting an existing completed name.

After a successful automatic backup, `MigrationRunner` will invoke the same manager's fixed 30-day
cleanup. The cleanup will recognize only established backup names, use the encoded UTC creation
time, preserve operator backups, revalidate each direct child before deletion, continue after
per-file failures, and return a structured report. The existing `db:backup` script will gain an
additive cleanup mode exposed as `npm run db:backup:cleanup`; cleanup defaults to preview and only
deletes with `--apply`. No new dependency, scheduler, database schema, MCP tool, or HTTP endpoint is
introduced.

## Technical Context

- **Language/Version**: Node.js 24+, TypeScript 5.9 ES modules, one existing Node `.mjs` CLI
- **Primary Dependencies**: `better-sqlite3` 12.11, Node `fs`/`path`/`crypto`, existing logger and PII masker
- **Storage**: SQLite database files in rollback-journal or WAL mode; adjacent `backups/` directory
- **Testing**: Vitest 3.2, real temporary SQLite databases and filesystem fixtures, subprocess CLI tests
- **Target Platform**: Linux-first Node server and Docker deployments; portable Node filesystem APIs
- **Project Type**: npm-workspace MCP server with an internal core package and operator CLI scripts
- **Performance Goals**: Scan and reconcile a 6,900-entry backup directory in one bounded pass; no database-sized in-memory buffers
- **Constraints**: Fixed 30-day automatic retention; no new dependency/configuration; preview by default; no recursive deletion; backup failure blocks migration while retention failure does not; completed names never expose unvalidated bytes or overwrite existing files
- **Scale/Scope**: One live SQLite database, one migration owner, approximately 6,900 historical artifacts and 5.5 GB currently reported; scale test uses 6,900 tiny files rather than allocating 5.5 GB

## Constitution Check

*GATE: Passed before Phase 0 and re-checked after Phase 1.*

| Principle | Plan evidence | Result |
| --- | --- | --- |
| I. Test-First Delivery | Add failing real-filesystem backup/cleanup, migration-boundary, no-pending-startup, and CLI contract tests before implementation. | PASS |
| II. Backward Compatibility | Keep the existing `npm run db:backup` invocation and success fields; add cleanup mode and a root export without changing MCP, REST, or restore contracts. | PASS |
| III. Schema and Migration Discipline | No database schema or migration artifact changes. | PASS |
| IV. Quality Gates | Run targeted Vitest first, then docs script verification, lint, type-check, full tests, and graphify rebuild after code changes. | PASS |
| V. Observability and Failure Isolation | Structured cleanup report reconciles selected/deleted/skipped/failed artifacts; retention failure is logged and nonblocking, while creation/validation failure blocks migration. | PASS |

Post-design re-check: the CLI contract is additive, the data model is file-backed only, and all
failure states have a testable transition. No constitution violation or unresolved clarification
remains.

## Design Decisions

### Backup creation boundary

1. Resolve the backup directory from the opened database's file path unless the caller supplied an
   explicit directory; reject in-memory databases.
2. Remove only stale files matching the strict implementation-owned in-progress grammar.
3. Call `db.backup()` into a unique same-directory in-progress `.db` name.
4. Use the completed backup metadata's `totalPages`, source page size, destination `page_count`, and
   final file stat to require `size === totalPages * pageSize` and nonzero bytes.
5. Open only the unpublished destination, checkpoint it to a standalone state, switch it to
   `journal_mode=DELETE`, require full `PRAGMA integrity_check` to return exactly `ok`, then close it.
6. Require the attempt's `-wal` and `-shm` companions to be absent after close; remove the whole
   unpublished artifact set on any failure and report any residue.
7. Sync the closed validated file, publish with a same-directory hard link from that inode to the
   completed name, then unlink the in-progress name. Link creation fails on collision, so an
   existing completed backup is never replaced; a handled post-link cleanup failure attempts to
   remove both names and reports any residue.

### Cleanup boundary

- Parse direct children into automatic, operator, in-progress, sidecar, or ignored artifacts with
  anchored filename grammars. Do not recurse or follow symbolic links.
- Automatic backups expire only when their valid encoded UTC timestamp is strictly older than one
  cutoff captured at operation start. Operator backups remain protected unless they are zero-byte;
  unrecognized, boundary-equal, invalid-timestamp, and future-dated files remain untouched.
- Zero-byte recognized backups and completed-backup sidecars are invalid artifacts and may be
  selected independent of age. Strict in-progress sets, including their sidecars, are selected only
  by explicit stopped-server cleanup; routine retention ignores them so it cannot delete an
  overlapping active operator attempt. Live-database sidecars never match the backup grammar.
- Inspection records `dev`, `ino`, type, size, and `mtimeMs`. Apply repeats `lstat` immediately
  before `unlink`; missing or changed candidates are skipped, individual I/O failures are failed,
  and remaining candidates continue.
- Node has no unlink-by-open-handle API. The final pathname race is accepted only under the stated
  trusted-directory, single-owner assumption; cleanup documentation requires the server and restore
  operations to be stopped before explicit apply.

### Integration boundary

- `MigrationRunner` retains the existing create-before-transaction order. A create/validation error
  returns an unsuccessful migration result before `migration.up()` runs.
- Routine cleanup runs once after a completed automatic backup is published, with interrupted-attempt
  recovery disabled. Its unsuccessful report is observable but does not invalidate that backup or
  block the migration.
- Existing initialization guards remain authoritative: if migration detection returns no pending
  migration, no `MigrationRunner` and no automatic backup is created.
- `scripts/backup-memory-db.mjs` delegates backup and cleanup behavior to the exported core manager.
  Its current no-argument behavior remains operator backup creation; `--cleanup` selects cleanup,
  and only the additional `--apply` flag authorizes deletion.

## Project Structure

### Documentation (this feature)

```text
specs/065-db-backup-retention/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── backup-cleanup-cli.md
└── tasks.md                    # Created later by /speckit.tasks
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── index.ts
└── infrastructure/database/sqlite/
    ├── init-migrate-existing.ts
    ├── init-migrate-existing.spec.ts
    └── migration/
        ├── backup-manager.ts
        ├── backup-manager.spec.ts
        ├── migration-runner.ts
        └── migration-runner.spec.ts

scripts/
├── backup-memory-db.mjs
└── __tests__/
    └── backup-memory-db.spec.ts

docs/
├── agents/commands.md
└── operations/ko/
    ├── docker-deploy-procedure.md
    └── scripts-index.md

CHANGELOG.md
package.json
```

**Structure Decision**: Keep the creation, validation, classification, and cleanup rules in the
existing core `BackupManager`, export that existing class through `@memento/core`, and make the
existing root script a thin operator adapter. A separate service, scheduler, cleanup script, or
dependency would duplicate boundaries already owned by this class.

## Implementation Strategy

1. **Lock behavior with failing tests**: replace shared backup test fixtures with isolated temporary
   directories; cover WAL snapshots, size/integrity gates, publication, cleanup classification,
   failure residue, cutoff behavior, revalidation, reports, 6,900-file scale, migration isolation,
   no-pending startup, and CLI preview/apply.
2. **Strengthen the shared boundary**: update `BackupManager` and its exported result/report types,
   then make `MigrationRunner` sequence creation and nonblocking retention.
3. **Reuse from the operator CLI**: preserve default backup behavior, add `--cleanup` and explicit
   `--apply`, emit the documented JSON contract, and add the npm alias.
4. **Document and verify**: update command/deployment indexes, run targeted and full quality gates,
   update the changelog, rebuild graphify with the repository command, and inspect
   `graphify-out/GRAPH_REPORT.md` without committing generated output.
