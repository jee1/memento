# Feature Specification: Database Backup Retention and Artifact Cleanup

**Feature Branch**: `jee1/chore-db-backups-6-900-5.5gb-0-sidecar`
**Created**: 2026-08-23
**Status**: Ready for Planning
**Issue**: [#814](https://github.com/jee1/memento/issues/814)
**Related**: #804, #810
**Input**: Migration backups must stop accumulating without limit, and invalid or residual backup
artifacts must be removed safely.

## User Scenarios & Testing

### User Story 1 - Keep automatic migration backups bounded (Priority: P1)

An operator can run the server and its migrations repeatedly without automatic migration backups
growing forever. Backups older than the 30-day retention period are removed after a successful new
migration backup, while backups explicitly created by an operator remain untouched.

**Why this priority**: Automatic migration backups account for nearly all 6,900 accumulated files
and 5.5 GB of storage. Bounding that growth addresses the primary operational problem.

**Independent Test**: Seed automatic migration backups on both sides of the 30-day cutoff and
operator-created backups of the same age, create one successful migration backup, and verify that
only expired automatic migration backups are removed.

**Acceptance Scenarios**:

1. **Given** automatic migration backups older and newer than 30 days, **When** a new migration
   backup succeeds, **Then** every expired automatic migration backup is removed and every
   unexpired automatic migration backup remains.
2. **Given** operator-created backups older than 30 days, **When** automatic retention runs,
   **Then** those operator-created backups remain unchanged.
3. **Given** cleanup fails for an individual expired file, **When** the operation completes,
   **Then** the successful backup remains usable and the cleanup failure identifies the affected
   artifact without being reported as a successful deletion or blocking the migration.
4. **Given** no migration is pending, **When** the server starts repeatedly, **Then** no automatic
   migration backup is created.

---

### User Story 2 - Produce only complete standalone backups (Priority: P1)

An operator can trust every backup reported as successful to be non-empty, complete relative to the
live database at creation time, internally consistent, and usable without residual companion files.
Failed attempts do not leave zero-byte, partial, `-wal`, or `-shm` artifacts behind.

**Why this priority**: Existing zero-byte and sidecar files show that current cleanup does not cover
every exit path. A partially copied database may still open, so opening it alone is not sufficient
proof of a complete backup.

**Independent Test**: Exercise successful creation plus failures before, during, and after backup
validation; verify that success requires size and integrity checks and that every failure removes
all artifacts from that attempt.

**Acceptance Scenarios**:

1. **Given** a stable source snapshot, **When** backup creation succeeds, **Then** the backup size is
   compared with the expected size captured at the same snapshot boundary and the backup passes an
   integrity check before success is reported.
2. **Given** an empty backup or one that differs from its source-snapshot size, **When** validation
   runs, **Then** creation fails, the incomplete database file is removed, and the reason is
   reported.
3. **Given** a backup attempt creates `-wal` or `-shm` companions, **When** the attempt succeeds or
   fails, **Then** those companions are removed only after the backup connection and checkpoint
   work are complete.
4. **Given** a failure during artifact cleanup, **When** the attempt ends, **Then** the operation is
   not reported as cleanly successful and the remaining artifact is identified.
5. **Given** backup creation or validation fails before a migration, **When** the migration runner
   receives the failure, **Then** the migration does not start.
6. **Given** backup creation is interrupted, **When** the backup directory is inspected or the next
   backup starts, **Then** the interrupted artifact is distinguishable from a completed backup and
   can be cleaned without treating it as restorable.

---

### User Story 3 - Safely clean the existing backlog (Priority: P2)

An operator can preview and then apply the same retention and invalid-artifact rules to the existing
backup directory. The result reports how many files and bytes would be or were removed, allowing the
operator to verify that the live database and deliberate backups are excluded.

**Why this priority**: Preventing future growth does not recover the 5.5 GB already consumed. A
preview is required because this cleanup deletes historical data.

**Independent Test**: Seed a directory shaped like the reported backlog, preview cleanup, apply it,
and verify identical selection, accurate counts and byte totals, preservation of protected files,
and an empty second apply result.

**Acceptance Scenarios**:

1. **Given** expired and current automatic migration backups, operator-created backups, zero-byte
   files, and backup sidecars, **When** cleanup is previewed, **Then** the report lists only artifacts
   eligible under the retention and invalid-artifact rules and makes no changes.
2. **Given** an unchanged directory after preview, **When** cleanup is applied, **Then** it removes
   exactly the previewed artifacts and reports deleted and failed counts plus reclaimed bytes.
3. **Given** cleanup has already completed, **When** it is applied again, **Then** no additional
   files are removed and the report shows zero reclaimed bytes.
4. **Given** the live database or an operator-created backup is present, **When** cleanup runs,
   **Then** neither is selected or modified.
5. **Given** cleanup apply was not explicitly requested, **When** the cleanup operation runs,
   **Then** it performs preview only and deletes nothing.

### Edge Cases

- A backup timestamp exactly on the 30-day cutoff is retained; only older automatic migration
  backups expire.
- Unrecognized files and directories in the backup directory are ignored and reported separately.
- A symbolic link or path outside the resolved backup directory is never followed or deleted.
- Files disappearing between preview, inspection, and deletion are reported without aborting the
  remaining eligible cleanup.
- A candidate whose type, size, modification time, or resolved location changes after inspection is
  skipped rather than deleted.
- A newly created successful migration backup is retained even while older backups are cleaned.
- A future creation timestamp is never treated as expired.
- An automatic-backup filename with an absent or invalid creation timestamp is preserved and
  reported as unrecognized rather than aged from a fallback timestamp.
- Residual `-wal` and `-shm` files are removed only when they belong to a backup artifact, never when
  they belong to the live database.
- Disk exhaustion, permission failure, or process interruption cannot expose an unvalidated file
  under a completed-backup name.
- A completed-backup name collision never overwrites the existing backup.
- A historical non-zero operator backup is preserved when its original source size is unavailable;
  current live-database size is not a valid completeness comparison for an older snapshot.

## Requirements

### Functional Requirements

- **FR-001**: The delivery MUST document a reproducible cause for each backup path that can leave a
  zero-byte, partial, `-wal`, or `-shm` artifact.
- **FR-002**: Automatic migration backups MUST have a fixed retention period of 30 days.
- **FR-003**: Retention MUST run after each successful automatic migration backup and MUST remove
  only automatic migration backups older than the retention cutoff.
- **FR-004**: Retention MUST NOT delete valid non-zero operator-created backups, the live database,
  unrecognized files, or any path outside the backup directory.
- **FR-005**: A backup MUST be reported as successful only after it is non-empty, its size matches
  the expected size captured at the same source-snapshot boundary, and it passes an integrity
  check.
- **FR-006**: Backup validation and artifact cleanup MUST occur after backup writes, connection
  closure, and required checkpoint work have completed; size comparison alone MUST NOT establish
  integrity.
- **FR-007**: A failed backup attempt MUST remove its database file and associated `-wal` and `-shm`
  files; any cleanup failure MUST identify the remaining artifact.
- **FR-008**: Successful backup completion MUST leave exactly one standalone database artifact and
  no associated sidecar files.
- **FR-009**: Existing-backlog cleanup MUST provide a no-change preview before destructive apply.
- **FR-010**: Preview and apply MUST use the same selection rules and report selected, deleted,
  skipped, and failed artifact counts plus selected or reclaimed bytes.
- **FR-011**: Existing-backlog cleanup MUST remove expired automatic migration backups, zero-byte
  backup files, and orphaned backup sidecars while preserving protected files.
- **FR-012**: Cleanup MUST be idempotent: a second apply against an unchanged directory MUST select
  no additional artifacts.
- **FR-013**: Backup creation failure and cleanup failure MUST remain observable without exposing
  the database path or other sensitive filesystem details in untrusted output.
- **FR-014**: Automated regression coverage MUST prove retention boundaries, operator-backup
  preservation, size mismatch rejection, sidecar cleanup timing, failure cleanup, preview/apply
  parity, and idempotence before implementation is complete.
- **FR-015**: An automatic retention failure MUST NOT invalidate a successful new backup, block its
  migration, or prevent server startup; it MUST remain observable as incomplete maintenance.
- **FR-016**: A backup creation or validation failure MUST block the migration that depends on that
  backup.
- **FR-017**: A backup MUST NOT appear under its completed-backup identity until its validation and
  artifact-cleanup gates have passed, and an existing completed backup MUST never be overwritten.
- **FR-018**: An interrupted attempt MUST remain distinguishable from a completed backup and MUST be
  eligible for safe recovery cleanup on the next backup or explicit cleanup operation.
- **FR-019**: Destructive backlog cleanup MUST require explicit apply intent; its default behavior
  MUST be preview-only.
- **FR-020**: Immediately before deletion, cleanup MUST revalidate that the candidate is the same
  regular file within the backup directory that was inspected; changed, missing, linked, or
  relocated candidates MUST be skipped and reported.
- **FR-021**: Historical non-zero operator backups without contemporaneous source-size evidence MUST
  be preserved even when their completeness cannot be proven retrospectively.
- **FR-022**: Routine and one-time cleanup MUST continue across per-artifact failures and return a
  non-successful maintenance result when any selected artifact could not be removed.
- **FR-023**: Retention MUST calculate one cutoff at operation start from the UTC creation timestamp
  encoded in a recognized automatic-backup name; missing, invalid, boundary-equal, or future
  timestamps MUST NOT expire.
- **FR-024**: The system MUST create no automatic migration backup when no migration is pending.

### Key Entities

- **Automatic migration backup**: A backup created before a migration, with its migration version,
  creation time, size, and retention eligibility.
- **Operator-created backup**: A deliberate backup created through the operator workflow; it is not
  governed by automatic migration retention in this feature.
- **Backup artifact set**: A backup database file and any associated `-wal` or `-shm` companions
  created during the same attempt.
- **In-progress backup**: An unpublished artifact produced during backup creation that cannot be
  mistaken for or selected as a completed restorable backup.
- **Cleanup report**: A preview or apply result containing selected, deleted, skipped, and failed
  counts, byte totals, and safe artifact identifiers.

### Assumptions

- The existing 30-day default is retained because the repository already defines that migration
  backup retention period. Per-install retention configuration is not introduced by this feature.
- Automatic migration and operator-created backups remain distinguishable by their established
  names; ambiguous or unrecognized files are preserved.
- Zero-byte files and orphaned backup sidecars are not valid operator backups and may be removed
  regardless of age after they are confirmed to belong to the backup directory.
- The one-time backlog cleanup is explicitly invoked by an operator; routine retention continues
  automatically after successful migration backup creation.
- One process owns migration execution for a database. Cleanup still tolerates directory changes
  caused by an overlapping operator backup or another cleanup invocation.

### Out of Scope

- Automatic retention or deletion of operator-created backups.
- Changes to restore behavior or migration rollback semantics.
- A new scheduler, backup service, or remote backup destination.
- A configurable retention period or count-based secondary retention policy.
- Cleanup of `memory_forgetting_event` records tracked by #810.
- Changes to the isolation work tracked by #804.

## Open Questions

| ID | Decision | Resolution |
| --- | --- | --- |
| Q1 | Operator-backup retention | Resolved: preserve every non-zero operator-created backup indefinitely in this feature. |
| Q2 | Automatic retention bound | Resolved: use the existing 30-day period; do not add count-based or configurable retention. |
| Q3 | Cleanup failure effect | Resolved: routine retention failure is observable but does not block migration; backup failure does block it. |
| Q4 | Historical partial detection | Resolved: never compare an old backup with today's live size; preserve unverifiable operator backups. |
| Q5 | Interrupted backup visibility | Resolved: only validated artifacts receive a completed-backup identity. |
| Q6 | Directory churn during cleanup | Resolved: revalidate each candidate immediately before deletion and skip anything changed. |
| Q7 | Retention clock source | Resolved: use the recognized filename's UTC creation timestamp and one fixed cutoff per run. |
| Q8 | Startup without migrations | Resolved: create no automatic backup when no migration is pending. |

## Success Criteria

### Measurable Outcomes

- **SC-001**: After one successful migration backup, 100% of automatic migration backups older than
  30 days are removed and 100% of valid non-zero operator-created backups remain.
- **SC-002**: Across successful and injected-failure tests, 100% of reported-success backups are
  non-empty, snapshot-size-matched, integrity-checked standalone files; zero normal failure paths
  leave an unreported artifact, and interrupted attempts are recognized on the next operation.
- **SC-003**: Against a 6,900-file representative fixture, preview and apply select the same
  artifacts, report exact file and byte totals, and a second apply reports zero deletions.
- **SC-004**: The existing nine zero-byte files and sixteen orphaned sidecars are eligible for
  cleanup without selecting the live database or any operator-created backup.
- **SC-005**: An operator can determine from one cleanup report what was selected, deleted, skipped,
  or left after failure, with 100% of reported counts reconciling to inspected artifacts.
- **SC-006**: In failure tests, 100% of backup creation or validation failures block the dependent
  migration, while 100% of retention-only failures leave the new backup usable and allow the
  migration to proceed.
- **SC-007**: Across 100 repeated startup simulations with no pending migration, zero new automatic
  backup artifacts are created.

## Brainstorm Log

### 2026-08-23 - Retention, integrity, interruption, and cleanup safety

- Chose the smallest retention rule already present in the repository: 30 days for automatic
  migration backups only, with no new configuration or count-based policy.
- Preserved all non-zero operator-created backups; zero-byte files and orphaned sidecars are invalid
  artifacts rather than protected backups.
- Separated primary safety from maintenance isolation: backup failure blocks migration, while old
  backup cleanup failure is reported without blocking a valid new backup or migration.
- Replaced comparison against a potentially changing live file with comparison against the source
  snapshot boundary, followed by an independent integrity check.
- Added publication, interruption, collision, path revalidation, and concurrent-directory-change
  rules so partial or replaced files cannot be mistaken for completed backups or deleted unsafely.
- Fixed retention aging to the recognized UTC creation timestamp and required zero automatic
  backups on startup when no migration is pending.
- Current-flow inspection identified three root-cause candidates for implementation tests: the
  retention helper has no production caller; migration copy failures do not remove partial output;
  and the operator script cleans sidecars before later verification can recreate them while its
  failure exit bypasses the shared sidecar-cleanup path.
