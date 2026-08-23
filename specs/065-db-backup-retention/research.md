# Phase 0 Research: Database Backup Retention and Artifact Cleanup

## 1. Shared implementation boundary

**Decision**: Strengthen the existing `BackupManager` and reuse it from `MigrationRunner` and
`scripts/backup-memory-db.mjs`. Export the existing class and result/report types through
`@memento/core`; add no service, scheduler, or dependency.

**Rationale**: `BackupManager` is already the sole automatic migration backup owner, and the root
operator script already performs the same operation independently. One shared implementation fixes
the safety boundary once while preserving the current entry points. `better-sqlite3` and Node's
standard library already provide every required primitive.

**Alternatives considered**:

- A new backup service or factory: rejected as a second abstraction with one implementation.
- A second cleanup script with duplicate file rules: rejected because preview, apply, and routine
  retention must use identical classification.
- Changes to `migrate-embedding-data.js`, `backup-daily.bat`, or JSON embedding export: rejected as
  unrelated backup-like flows outside the measured migration/operator directory and feature scope.

## Current failure reproduction

The implementation phase must turn these source-level causes into regression tests before changing
behavior:

1. **Automatic migration path**
   (`packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts`): the
   manager copies the live main file directly to a completed name with `copyFileSync`. In WAL mode,
   commit a row while it remains in `-wal`, invoke the current method, and the copied main file can
   omit that committed row. An injected copy/write failure after destination creation also leaves
   the completed `.db` because the catch path logs and rethrows without removing an artifact set.
2. **Operator path** (`scripts/backup-memory-db.mjs`): the script chooses the completed name before
   validation and unlinks a collision. Its backup catch removes only `.db`; its success path deletes
   sidecars before opening the backup for `quick_check`, and a validation failure after that open has
   no shared cleanup. Inject failure at backup, sidecar unlink, and integrity stages to reproduce the
   zero/sidecar/residue exits.
3. **Retention path** (`BackupManager.cleanupOldBackups`): no production caller exists. Directly
   invoking it shows that it selects every old `.db` from mutable `mtime`, including operator
   backups, stops at the first thrown filesystem operation, returns only a deletion count, and
   converts the outer failure into `0`. Repeated successful pre-migration backups therefore
   accumulate without routine retention or an observable incomplete-maintenance result.

The existing initialization guards already skip the runner when no migration is pending; retain
that behavior and add the 100-startup regression rather than adding a new startup backup path.

## 2. Consistent live SQLite snapshot

**Decision**: Replace automatic migration `copyFileSync` with `await db.backup(inProgressPath)` on
the already-open `better-sqlite3` connection. Operator backups use the same core path.

**Rationale**: A WAL database can have committed pages in `-wal` that are absent from the main file.
SQLite's Online Backup API creates a consistent snapshot while the database remains in use, and
`better-sqlite3` reports completion metadata. The current automatic path copies only the main file,
while the operator path already uses the correct API.

**Alternatives considered**:

- Copying `.db`, `-wal`, and `-shm`: rejected because a correct quiescent boundary is easy to break.
- `VACUUM INTO`: safe but unnecessary; it rewrites/compacts rather than reusing the installed backup
  API.
- Forcing a live checkpoint before raw copy: rejected because it adds write coordination and still
  requires excluding writes between checkpoint, stat, and copy.

Sources: [SQLite backup safety](https://sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active),
[SQLite Online Backup API](https://sqlite.org/backup.html),
[better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise).

## 3. Snapshot-relative completeness and integrity

**Decision**: At the completed backup boundary, require `remainingPages === 0`, capture
`totalPages`, and validate the unpublished destination as nonzero with
`stat.size === totalPages * sourcePageSize`, destination `page_count === totalPages`, destination
`page_size === sourcePageSize`, and full `PRAGMA integrity_check` returning exactly one `ok` row.

**Rationale**: The backup result's page count belongs to the same snapshot. Comparing an old backup
or a WAL main file to the current source-file byte size is not valid. Byte/page agreement proves
completeness at the snapshot boundary, while full integrity checking independently covers database
structure and index/table consistency.

**Alternatives considered**:

- Source main-file `stat` equality: rejected for normal WAL operation.
- `quick_check`: rejected because SQLite documents that it omits some index and constraint checks.
- Historical comparison against today's live file: rejected because database growth is expected and
  no contemporaneous source-size evidence exists for old operator backups.

Sources: [SQLite page count](https://sqlite.org/pragma.html#pragma_page_count),
[SQLite file pages](https://sqlite.org/fileformat.html#pages),
[SQLite integrity check](https://sqlite.org/pragma.html#pragma_integrity_check).

## 4. Standalone artifact and sidecar lifecycle

**Decision**: Validate only the unpublished destination. Checkpoint it with `wal_checkpoint(TRUNCATE)`,
require no busy/uncheckpointed frames, set `journal_mode=DELETE`, run integrity checking, and close
the connection before asserting that its `-wal` and `-shm` files are absent. On any failure, remove
the entire unpublished `.db`/`-wal`/`-shm` set and report residue.

**Rationale**: WAL is persistent database state, so unlinking a live or hot WAL while retaining its
database can lose commits. Converting the closed backup to rollback-journal mode produces one
standalone artifact. Removing the whole unpublished attempt after all handles close is safe because
it was never restorable or published.

**Alternatives considered**:

- Unlink sidecars before validation: rejected because opening the WAL-mode backup for validation can
  recreate them and deleting a hot WAL is unsafe.
- Accept a completed `.db` plus sidecars: rejected by the standalone-backup requirement.

Source: [SQLite WAL persistence and lifecycle](https://sqlite.org/wal.html#the_wal_file).

## 5. Atomic publication without overwrite

**Decision**: Write a strict same-directory `.partial-<uuid>.db` identity, validate and close it,
sync the file, then publish with `fsPromises.link(inProgress, completed)` and unlink the in-progress
name. Treat an existing completed name as a hard failure. If the post-link unlink fails during a
handled operation, attempt to remove both names and report any residue; after a process crash, the
next operation may preserve the already valid completed link and remove only the matching partial.

**Rationale**: A hard link exposes the already validated inode under the final name atomically and
fails if that destination exists. Same-directory placement ensures one filesystem. A crash after
link but before unlink leaves a valid completed file plus a recognizable extra partial name, which
the next operation can remove.

**Alternatives considered**:

- `rename`: rejected because Node rename overwrites an existing destination.
- `copyFile(..., COPYFILE_EXCL)`: avoids overwrite but exposes a partially copied final file.
- Pre-create the completed path with `wx`: avoids overwrite but exposes a zero-byte completed name
  if interrupted.

Sources: [Node hard links](https://nodejs.org/api/fs.html#fspromiseslinkexistingpath-newpath),
[Node rename behavior](https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback),
[Node TOCTOU guidance](https://nodejs.org/api/fs.html#fspromisesaccesspath-mode),
[Node file sync](https://nodejs.org/api/fs.html#filehandlesync).

## 6. Retention classification and clock

**Decision**: Capture one `now` and cutoff per scan. Strictly parse automatic names as
`memory-backup-<numeric dotted migration version>-<UTC timestamp>.db` and operator names as
`memory-backup-<UTC timestamp>.db`. Only automatic backups with a valid timestamp strictly older
than 30 days expire. Preserve operator, unknown, invalid-timestamp, cutoff-equal, and future files.
Select zero-byte recognized backups and completed-backup sidecars as invalid artifacts independent
of age. Select owned partials and their sidecars only during explicit cleanup under its
stopped-server prerequisite; routine retention ignores partial sets because directory churn may be
an active operator backup.

**Rationale**: The encoded UTC time is immutable intent; `mtime` is mutable during copying or manual
operations. Anchored disjoint grammars prevent operator backups from entering automatic retention.
The rule matches the repository's established two naming forms and the specification's fixed
retention policy.

**Alternatives considered**:

- `mtime`: rejected because it can change without changing backup age.
- All `.db` files: rejected because it deletes valid operator and unrecognized databases.
- A fallback timestamp or configurable/count cap: rejected because it broadens destructive scope and
  is explicitly out of scope.

## 7. Safe preview/apply and failure reporting

**Decision**: Enumerate direct children only, use `lstat`, reject links and non-files, record
`dev`/`ino`/type/size/`mtimeMs`, and repeat `lstat` immediately before `unlink`. Missing or changed
candidates become `skipped`; I/O errors become `failed`; processing continues. Preview and apply
share one selector and return one reconciled report using basenames only.

**Rationale**: This prevents recursion, symlink traversal, and deletion of a candidate that visibly
changed after inspection. Per-artifact outcomes make incomplete maintenance observable without
blocking a valid migration backup.

**Alternatives considered**:

- `stat` or `realpath` followed by deletion: rejected because they can follow links or introduce
  check/use races.
- Abort on first error: rejected because it leaves the remainder unprocessed and cannot provide a
  complete cleanup report.
- Claiming hostile-directory safety: rejected because Node has no unlink-by-open-handle primitive;
  the design relies on the specified trusted directory and single migration owner.

Sources: [Node `lstat`](https://nodejs.org/api/fs.html#fspromiseslstatpath-options),
[Node `unlink`](https://nodejs.org/api/fs.html#fspromisesunlinkpath).

## 8. Migration and CLI failure isolation

**Decision**: Keep backup creation before the migration transaction. Run routine retention exactly
once after successful publication in a separate nonthrowing maintenance branch that excludes
in-progress artifacts. Preserve existing pending-migration guards. Extend `backup-memory-db.mjs`
with `--cleanup` and optional `--apply`, and register `db:backup:cleanup` as a documented npm alias.

**Rationale**: The current runner already prevents `migration.up()` after a thrown backup failure,
and initialization already avoids constructing a runner when no migration is pending. Separating
retention from creation meets failure-isolation requirements. Extending the existing CLI preserves
the operator workflow and avoids a second script.

**Alternatives considered**:

- Cleanup before backup: rejected because cleanup must not make a failed backup attempt the only
  maintenance event and the new valid artifact must exist before old ones are removed.
- Retention failure throwing through migration: rejected because old-file maintenance must not
  invalidate a new verified backup.
- New startup cleanup or scheduler: rejected as unnecessary and out of scope.

## Resolved Clarifications

All planning questions are resolved. The feature requires no new database schema, remote API,
security scope, dependency, retention configuration, or restore behavior.
