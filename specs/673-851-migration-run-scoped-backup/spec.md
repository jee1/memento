# Feature Specification: Migration Run-Scoped Backup

**Feature Branch**: `feature/chore-db-1-40-1`  
**Created**: 2026-09-06  
**Status**: Brainstormed  
**Issue**: [#851](https://github.com/jee1/memento/issues/851)  
**Related**: #849 / PR #850 (retention count cap), #852 (log rotation; separate)  
**Input**: `migration-runner.ts` calls `createBackup` once per migration version.
With ~40 pending versions on a cold/boot path, each start writes ~40 full DB
copies (~143–175MB each). Retention (#850) bounds directory size; remaining
waste is creation churn. Prefer **one backup per migration run**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One backup per batch run (Priority: P1)

An operator starting the server (or otherwise applying a batch of pending
migrations via `runMigrations`) gets a single pre-run database snapshot even
when many versions apply in that boot. Disk write volume drops from
≈ N × DB size to ≈ 1 × DB size for that run.

**Why this priority**: Issue measured ~40 backups per boot and ~5.7GB write per
start; #850 only caps survivors, not write amplification.

**Independent Test**: Spy/`createBackup` call count while `runMigrations` applies
N≥2 migrations with `createBackup: true`; assert exactly 1 create.

**Acceptance Scenarios**:

1. **Given** N≥2 pending migrations and `createBackup: true`, **When**
   `runMigrations` completes successfully, **Then** `createBackup` is invoked
   exactly once before the first version’s `up`.
2. **Given** the same batch with `createBackup: false`, **When**
   `runMigrations` runs, **Then** zero backups are created.
3. **Given** an empty migration list, **When** `runMigrations` runs with
   `createBackup: true`, **Then** zero backups are created.
4. **Given** `createBackup: true` on a multi-version run, **When** backup create
   succeeds, **Then** retention cleanup (`cleanupBackups`) is attempted at most
   once for that run (not once per version).

---

### User Story 2 - Single-version path unchanged (Priority: P1)

A caller invoking `runMigration` for one version with `createBackup: true` still
gets exactly one backup for that call (no regression for direct single-version
use).

**Why this priority**: Nightly/tests and any direct callers must keep the
existing single-call contract.

**Independent Test**: `runMigration` with `createBackup: true` → one
`createBackup`; with `false` → zero.

**Acceptance Scenarios**:

1. **Given** one migration and `createBackup: true`, **When** `runMigration`
   runs, **Then** exactly one backup is created.
2. **Given** `createBackup: false`, **When** `runMigration` runs, **Then** no
   backup is created and migration may still succeed.

---

### User Story 3 - Failure / rollback semantics preserved (Priority: P1)

On mid-batch failure, SQL transaction rollback + `migration.down()` /
`removeVersion` path remains the automatic recovery mechanism. File-level
`restoreBackup` is not required for automatic success of that path (today
`rollbackMigration` ignores the backup path argument). The pre-run snapshot
remains available for operator/manual recovery.

**Why this priority**: Issue asked to verify rollback does not depend on
per-version backup files; code confirms `findLatestBackup`/`restoreBackup` have
no production callers and `rollbackMigration` does not restore from file.

**Independent Test**: Batch of migrations where a later version fails with
`autoRollback: true`; assert earlier committed versions stay applied (SQL
semantics), failed version not recorded, and `createBackup` still called once
for the run when enabled.

**Acceptance Scenarios**:

1. **Given** migrations A then failing B with `createBackup: true` and
   `autoRollback: true`, **When** the batch stops, **Then** A remains applied,
   B is not recorded as applied, and only one run-scoped backup was created.
2. **Given** backup create fails before the batch, **When** `runMigrations`
   starts with `createBackup: true`, **Then** no migration `up` runs (fail
   closed before schema changes), matching today’s create-before-up ordering
   intent at run scope.

---

### User Story 4 - High-churn regression proof (Priority: P1)

A unit test proves that applying many migrations in one `runMigrations` call
does not scale backup creates with N.

**Why this priority**: #849/#850 showed count caps can hide creation waste;
this issue’s regression must encode create-count = 1.

**Independent Test**: Temp file DB only — never touch live `DB_PATH`.

**Acceptance Scenarios**:

1. **Given** a temp DB and N≥5 synthetic migrations with `createBackup: true`,
   **When** `runMigrations` succeeds, **Then** `createBackup` call count === 1.
2. **Given** operator-facing logs from that run, **When** inspected in tests,
   **Then** assertions do not require printing absolute live home paths.

### Edge Cases

- Backup create fails → abort batch before any `up` (fail closed).
- `:memory:` DB → existing “no file backup” error behavior; batch must not
  proceed if createBackup requested and create fails.
- Mid-batch failure after successful versions → do not create additional
  per-version backups while unwinding.
- `createBackup` default remains `true` for production init paths.
- Filename may still embed a version label (e.g. first pending version) for
  operator recognition; label MUST NOT imply one file per applied version in
  the same run.
- Concurrent second process writing backups → out of scope; existing
  partial/UUID naming remains.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `runMigrations` with `createBackup: true` and non-empty list MUST
  create at most **one** backup for the entire batch (pre-first-`up`).
- **FR-002**: Per-version `runMigration` MUST NOT create additional backups when
  invoked as part of that batched run.
- **FR-003**: Direct `runMigration(..., { createBackup: true })` MUST still
  create exactly one backup for that single call.
- **FR-004**: `createBackup: false` MUST suppress backup creation for both
  `runMigration` and `runMigrations`.
- **FR-005**: Empty migration list MUST create zero backups.
- **FR-006**: Automatic rollback on failure MUST continue to rely on transaction
  `ROLLBACK` + `down()` / version removal; MUST NOT newly require per-version
  file restore for correctness.
- **FR-007**: If run-scoped backup creation fails, the batch MUST NOT apply any
  migration `up`.
- **FR-008**: Retention cleanup after a successful run-scoped create SHOULD run
  at most once per batch (not once per version).
- **FR-009**: Automated tests MUST assert `createBackup` call count === 1 for
  multi-version `runMigrations` with backups enabled.
- **FR-010**: Schema-change-only backup filtering is **out of MVP**; run-scoped
  always-on (when `createBackup: true`) is the chosen policy.

### Key Entities

- **Migration run**: One `runMigrations` invocation over an ordered list.
- **Run-scoped backup**: Single pre-run snapshot for that invocation.
- **Version migration**: One `Migration` applied via `up` / recorded version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For N≥5 migrations in one `runMigrations` with backups on,
  `createBackup` invocations === 1 (unit test).
- **SC-002**: Production init paths that call `runMigrations` inherit run-scoped
  behavior without API break (`createBackup: true` still accepted).
- **SC-003**: Existing `runMigration` single-call backup tests remain green.
- **SC-004**: Mid-batch failure does not require `restoreBackup` for automatic
  rollback path to succeed in tests.

## Assumptions

- #850 retention (`AUTOMATIC_RETENTION_COUNT`) stays as-is; this issue only
  reduces creation rate.
- `rollbackMigration`’s unused `_backupPath` may remain unused; no requirement
  to wire `restoreBackup` into auto-rollback for MVP.
- Live `~/.memento` backlog of old per-version backups is drained by existing
  retention cleanup over time, not by a new wipe CLI.

## Out of Scope

- Schema-change-only backup gating (issue alternate; deferred).
- Changing `AUTOMATIC_RETENTION_COUNT` / age policy (#849/#850).
- New operator restore CLI / wiring `findLatestBackup` into production.
- Reducing migration **log** file creation (#852 covers rotation).
- Vacuum / freelist reclaim (issue comment; separate ops).

## Open Questions

| ID | Question | Status |
|----|----------|--------|
| Q1 | Run-scoped one backup vs schema-change-only? | Resolved — run-scoped (issue primary) |
| Q2 | Mid-batch failure: restore pre-run file vs keep committed versions? | Resolved — keep committed + SQL/`down` for failed version; no file restore required |
| Q3 | Backup filename version tag for a batch? | Resolved — use first pending version (or equivalent single label); not one file per version |
| Q4 | `cleanupBackups` once per run vs per version? | Resolved — once per successful run-scoped create |
| Q5 | Fail closed if run backup create fails? | Resolved — yes; no `up` until backup ok when createBackup true |
| Q6 | Change single `runMigration` contract? | Resolved — no; keep one backup per direct call |

## Brainstorm Log

### 2026-09-06 — Session 1 (canonical auto-select)

User authorized Speckit pipeline for #851 with recommended auto-select
(memory: constitution→specify→brainstorm auto→plan→tasks→execute∥review;
commit/push only on explicit request).

- **Q1 Recommended**: Run-scoped 1 backup — matches issue primary proposal;
  schema-change-only deferred (harder to define, smaller win if most versions
  change schema anyway).
- **Q2 Recommended**: Preserve today’s effective rollback: transaction
  ROLLBACK + `down()`; `rollbackMigration` does not call `restoreBackup`;
  do **not** redefine batch as “restore entire pre-run on any failure” (would
  undo successful committed versions).
- **Q3 Recommended**: Single filename may include first pending version for
  continuity with `memory-backup-${version}-…` pattern.
- **Q4 Recommended**: Move cleanup to run scope to avoid N cleanup scans.
- **Q5 Recommended**: Fail closed before any `up` if backup create fails.
- **Q6 Recommended**: Leave direct `runMigration` behavior intact.

Status: **Brainstormed** — Open Questions = 0.
