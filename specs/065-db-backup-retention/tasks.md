# Database Backup Retention and Artifact Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound automatic migration backups to 30 days, make every reported-success backup a
validated standalone SQLite snapshot, and provide a preview-first operator cleanup for the existing
backlog.

**Architecture:** Keep creation, validation, filename classification, cleanup selection, and cleanup
reporting in the existing `BackupManager`. `MigrationRunner` sequences validated automatic backup
then nonblocking retention; `scripts/backup-memory-db.mjs` remains the single operator entry point
and delegates both backup and cleanup to the exported core manager.

**Tech Stack:** Node.js 24+, TypeScript 5.9 ES modules, `better-sqlite3` 12.11, Node filesystem
stdlib, Vitest 3.2, npm workspaces.

**Spec:** `specs/065-db-backup-retention/spec.md`

**Scope check:** Automatic backups, operator backups, and backlog cleanup are not independent
subprojects: all three must share one artifact classifier and validation boundary, so splitting them
would duplicate the destructive rules the specification requires to remain identical.

## Global Constraints

- Use the existing `BackupManager`, `better-sqlite3`, logger, PII masker, and Node stdlib; add no
  dependency, service, scheduler, database schema, MCP tool, HTTP endpoint, or retention setting.
- Automatic retention is exactly 30 days and applies only to strictly recognized automatic
  migration backups; preserve valid nonzero operator backups indefinitely.
- Use a single cutoff captured at cleanup start and the UTC timestamp encoded in the filename; do
  not fall back to `mtime` or compare historical backups to the current live database size.
- Never recurse, follow symlinks, overwrite a completed backup name, expose an unvalidated completed
  name, or delete outside the direct backup directory.
- Backup creation/validation failure blocks migration. Retention-only failure remains observable but
  does not invalidate the new backup, block migration, or block startup.
- Cleanup defaults to preview. Only exact `--cleanup --apply` intent may delete existing artifacts.
- Use safe basenames and masked errors in failure output. Preserve the existing successful
  `db:backup` output fields required by operators.
- Every `[TDD]` task follows RED → GREEN → REFACTOR. A RED run must fail for the named missing
  behavior, not for a syntax, fixture, build, or import error.
- Every commit follows the repository Lore protocol. Do not commit `graphify-out/`.

---

## Phase 1: Setup — Isolated Regression Harness

**Purpose:** Remove shared filesystem state from backup tests and record the unchanged baseline
before adding behavior.

### T001 — Isolate the backup-manager test filesystem

- [ ] T001 [SUBAGENT] Replace the shared `data/test-backups` fixture with one temporary directory per test and preserve the 4-test baseline.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`

**Interfaces:**

- Consumes: existing `BackupManager(backupsDir?: string)` and its current public methods.
- Produces: `testRoot`, `dbPath`, and `backupsDir` fixtures that later tasks may extend without
  sharing files across tests.

- [ ] **Step 1: Run the current baseline**

  Run:

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  ```

  Expected: PASS, 1 file and 4 tests.

- [ ] **Step 2: Replace the shared directory and sleep with isolated setup/teardown**

  Use the existing Node stdlib only:

  ```ts
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'memento-backup-manager-'));
    dbPath = join(testRoot, 'memory.db');
    backupsDir = join(testRoot, 'backups');
    backupManager = new BackupManager(backupsDir);
  });

  afterEach(() => rmSync(testRoot, { recursive: true, force: true }));
  ```

  Remove the fixed `100ms` delay; use explicit timestamps in later tests.

- [ ] **Step 3: Prove behavior did not change**

  Run the command from Step 1.

  Expected: PASS, 1 file and 4 tests; no `data/test-backups` residue.

- [ ] **Step 4: Commit the test-harness change**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Isolate backup regression evidence from shared filesystem state" -m "Constraint: Existing backup behavior remains unchanged" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: backup-manager.spec.ts 4/4"
  ```

**Checkpoint:** The existing tests are deterministic and no runtime behavior has changed.

---

## Phase 2: Foundational — Shared Artifact and Report Contract

**Purpose:** Define the one filename classifier and cleanup result shape consumed by all stories.

**⚠️ CRITICAL:** T002 blocks every user-story phase.

### T002 — Define strict backup identities and cleanup report types

- [ ] T002 [TDD] Add strict automatic/operator/in-progress/sidecar parsing and the cleanup report types to the existing manager module.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts`

**Interfaces:**

- Consumes: current completed names `memory-backup-<version>-<timestamp>.db` and
  `memory-backup-<timestamp>.db`.
- Produces:

  ```ts
  export type CleanupMode = 'preview' | 'apply';
  export type CleanupSelectionReason =
    | 'expired-automatic'
    | 'zero-byte-backup'
    | 'orphaned-sidecar'
    | 'interrupted-attempt';
  export type CleanupStatus = 'selected' | 'deleted' | 'skipped' | 'failed';
  export type CleanupDetail =
    | 'inspect-failed'
    | 'missing-before-delete'
    | 'changed-before-delete'
    | 'delete-failed'
    | null;

  export interface CleanupArtifactOutcome {
    id: string;
    status: CleanupStatus;
    reason: CleanupSelectionReason;
    detail: CleanupDetail;
  }

  export interface CleanupReport {
    ok: boolean;
    error: 'scan-failed' | null;
    mode: CleanupMode;
    inspectedCount: number;
    selectedCount: number;
    selectedBytes: number;
    deletedCount: number;
    reclaimedBytes: number;
    skippedCount: number;
    failedCount: number;
    ignoredCount: number;
    artifacts: CleanupArtifactOutcome[];
  }

  export interface CleanupOptions {
    mode?: CleanupMode;
    now?: Date;
    includeInterrupted?: boolean;
  }
  ```

- [ ] **Step 1: Write failing filename-classification tests**

  Add table cases through the observable preview report rather than exporting a parser:

  ```ts
  it.each([
    ['memory-backup-2.0-2026-06-01T00-00-00-000Z.db', true],
    ['memory-backup-2026-06-01T00-00-00-000Z.db', false],
    ['memory-backup-2.0-not-a-date.db', false],
    ['memory-backup-2.0-2099-06-01T00-00-00-000Z.db', false],
  ])('classifies only valid expired automatic names: %s', async (name, selected) => {
    writeFileSync(join(backupsDir, name), 'x');
    const report = await backupManager.cleanupBackups({
      now: new Date('2026-08-23T00:00:00.000Z'),
    });
    expect(report.artifacts.some(item => item.id === name)).toBe(selected);
  });
  ```

- [ ] **Step 2: Run RED**

  Run:

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  ```

  Expected: FAIL because `cleanupBackups` and its report do not exist.

- [ ] **Step 3: Add the minimum strict parser and empty report assembly**

  Keep helpers private in `backup-manager.ts`; validate normalized dates by round-tripping:

  ```ts
  const TIMESTAMP_PATTERN = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;
  const AUTOMATIC_NAME = new RegExp(
    `^memory-backup-(\\d+(?:\\.\\d+)+)-${TIMESTAMP_PATTERN.source}\\.db$`
  );
  const OPERATOR_NAME = new RegExp(`^memory-backup-${TIMESTAMP_PATTERN.source}\\.db$`);
  const IN_PROGRESS_NAME = /^\.memory-backup-partial-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/;

  async cleanupBackups(options: CleanupOptions = {}): Promise<CleanupReport> {
    const mode = options.mode ?? 'preview';
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - 30 * DAY_MS;
    let names: string[];
    try {
      names = fs.readdirSync(this.backupsDir);
    } catch {
      return emptyCleanupReport(mode, 'scan-failed');
    }
    const artifacts = names.flatMap(name => {
      const reason = classifySelection(name, cutoff, options.includeInterrupted ?? false);
      return reason === null ? [] : [{ id: name, status: 'selected', reason, detail: null }];
    });
    return buildPreviewReport(mode, names.length, artifacts);
  }
  ```

  Define private `emptyCleanupReport`, `classifySelection`, and `buildPreviewReport` in the same
  module. `classifySelection` round-trips the parsed timestamp, rejects invalid, future, and
  cutoff-equal timestamps, and never uses `mtime` as age. T003 adds filesystem identity/byte
  inspection and the apply branch without changing these names.

- [ ] **Step 4: Run GREEN and type-check the package**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  npm run type-check -w @memento/core
  ```

  Expected: both commands exit 0.

- [ ] **Step 5: Commit the shared contract**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Make destructive backup selection depend on strict immutable identities" -m "Rejected: mtime and catch-all .db matching | they can delete operator or ambiguous files" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: backup-manager.spec.ts; @memento/core type-check"
  ```

**Checkpoint:** Preview can distinguish the two completed namespaces without exposing a deletion
path; all later tasks use these exact types and reason strings.

---

## Phase 3: User Story 1 — Keep Automatic Migration Backups Bounded (Priority: P1) 🎯 MVP

**Goal:** After each successful automatic migration backup, remove only automatic backups strictly
older than 30 days, continue across maintenance failures, and create nothing when no migration is
pending.

**Independent Test:** Seed old/current automatic and old operator backups, run one automatic backup
plus retention, and verify only expired automatic files disappear while a forced cleanup failure is
reported without blocking migration.

### T003 — Implement fixed automatic retention and per-artifact reconciliation

- [ ] T003 [TDD] [US1] Implement preview/apply cleanup with operator preservation, one cutoff, immediate revalidation, and per-file continuation.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts`

**Interfaces:**

- Consumes: `CleanupOptions`, `CleanupReport`, and strict names from T002.
- Produces: `BackupManager.cleanupBackups(options?: CleanupOptions): Promise<CleanupReport>` with
  successful-scan invariants `inspectedCount = selectedCount + ignoredCount`,
  `artifacts.length = selectedCount`, and apply invariant
  `selectedCount = deletedCount + skippedCount + failedCount`.

- [ ] **Step 1: Write failing retention and reconciliation tests**

  Replace the legacy `cleanupOldBackups` test with `cleanupBackups`; do not carry its configurable
  mtime behavior forward. Cover one fixed `now`, expired/current/boundary/future automatic files,
  old nonzero operator files, invalid timestamps, directories, symlinks, an initial `lstat` failure,
  a missing candidate, one unlink failure, and a later successful candidate. Assert basenames only,
  exact counts/bytes, and scan-error shape:

  ```ts
  expect(report).toMatchObject({
    ok: false,
    mode: 'apply',
    selectedCount: 3,
    deletedCount: 1,
    skippedCount: 1,
    failedCount: 1,
  });
  expect(report.selectedCount).toBe(
    report.deletedCount + report.skippedCount + report.failedCount
  );
  expect(report.inspectedCount).toBe(report.selectedCount + report.ignoredCount);
  expect(report.artifacts).toHaveLength(report.selectedCount);
  expect(JSON.stringify(report)).not.toContain(testRoot);

  const backupsPathThatIsAFile = join(testRoot, 'not-a-directory');
  writeFileSync(backupsPathThatIsAFile, 'x');
  const managerWithScanFailure = new BackupManager(backupsPathThatIsAFile);
  expect(await managerWithScanFailure.cleanupBackups()).toMatchObject({
    ok: false,
    error: 'scan-failed',
    inspectedCount: 0,
    selectedCount: 0,
    artifacts: [],
  });
  ```

- [ ] **Step 2: Run RED**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  ```

  Expected: FAIL on apply behavior, preservation, revalidation, and failure reconciliation.

- [ ] **Step 3: Implement the single-pass selector and apply branch**

  Use `readdirSync` plus `lstatSync` on direct children. Record and compare the same fields before
  unlink:

  ```ts
  interface FileIdentity {
    dev: bigint | number;
    ino: bigint | number;
    mode: number;
    size: number;
    mtimeMs: number;
  }

  function sameIdentity(before: FileIdentity, after: FileIdentity): boolean {
    return before.dev === after.dev && before.ino === after.ino &&
      before.mode === after.mode && before.size === after.size &&
      before.mtimeMs === after.mtimeMs;
  }
  ```

  Never call `stat`, `realpath`, or recursive filesystem APIs. For a strict candidate whose initial
  `lstat` fails, return `failed`/`inspect-failed` with zero selected bytes and continue. Convert later
  `ENOENT` to skipped, identity/type changes to skipped, and other per-file errors to failed. Return
  `error: 'scan-failed'` with zero totals when direct-child enumeration fails. Remove the obsolete
  `cleanupOldBackups(retentionDays)` method and its old test instead of retaining a second
  mtime-based, configurable deletion rule; repository search has no production caller to preserve.

- [ ] **Step 4: Run GREEN**

  Run the T002 test/type-check commands.

  Expected: all backup-manager tests and core type-check pass.

- [ ] **Step 5: Commit retention behavior**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Bound automatic backup growth without aging deliberate operator snapshots" -m "Constraint: Retention is fixed at 30 days and filename-time based" -m "Rejected: Recursive and mtime-based cleanup | destructive scope is ambiguous" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: backup-manager.spec.ts; @memento/core type-check"
  ```

### T004 — Run retention after a successful automatic backup without blocking migration

- [ ] T004 [TDD] [US1] Sequence apply cleanup after publication and isolate an unsuccessful maintenance report from migration success.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.ts`

**Interfaces:**

- Consumes: `createBackup(db, migrationVersion)` and
  `cleanupBackups({ mode: 'apply', includeInterrupted: false })`.
- Produces: one routine cleanup call after each successful automatic backup; no throw from retention
  failure/report failure into `migration.up()`.

- [ ] **Step 1: Write RED tests for order and failure isolation**

  Spy through the existing `runner.getBackupManager()`:

  ```ts
  const validBackupResult = {
    backupPath: 'memory-backup-1.0-2026-08-23T00-00-00-000Z.db',
    timestamp: new Date('2026-08-23T00:00:00.000Z'),
    size: 4096,
  };
  const emptyApplyReport: CleanupReport = {
    ok: true,
    error: null,
    mode: 'apply',
    inspectedCount: 0,
    selectedCount: 0,
    selectedBytes: 0,
    deletedCount: 0,
    reclaimedBytes: 0,
    skippedCount: 0,
    failedCount: 0,
    ignoredCount: 0,
    artifacts: [],
  };
  const manager = runner.getBackupManager();
  const create = vi.spyOn(manager, 'createBackup').mockResolvedValue(validBackupResult);
  const cleanup = vi.spyOn(manager, 'cleanupBackups').mockResolvedValue({
    ...emptyApplyReport,
    ok: false,
    selectedCount: 1,
    failedCount: 1,
  });

  const result = await runner.runMigration(testMigration);
  expect(create).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledWith({ mode: 'apply', includeInterrupted: false });
  expect(create.mock.invocationCallOrder[0]).toBeLessThan(cleanup.mock.invocationCallOrder[0]);
  expect(result.success).toBe(true);
  expect(testMigration.up).toHaveBeenCalledOnce();
  ```

  Add a second case where `cleanupBackups` throws; assert safe observable logging and migration
  success. Add one real-file integration case that seeds expired/current automatic and old operator
  files in the opened database's sibling `backups/` directory, runs one migration with the actual
  manager, and proves a new backup plus current/operator files remain while expired automatic files
  are gone. This is the integrated SC-001 acceptance path, not a composition of mocks.

- [ ] **Step 2: Run RED**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts --reporter=default
  ```

  Expected: FAIL because the runner does not call retention.

- [ ] **Step 3: Add the nonblocking maintenance branch**

  Resolve the manager's default directory from the opened file database's `db.name` in the runner
  constructor; retain current in-memory behavior for tests. Add `dirname`/`join` imports from
  `node:path` and initialize it once:

  ```ts
  const backupDbName = this.db.name;
  const backupsDir = backupDbName && backupDbName !== ':memory:'
    ? join(dirname(backupDbName), 'backups')
    : undefined;
  this.backupManager = new BackupManager(backupsDir);
  ```

  Place maintenance immediately after `createBackup` returns and before `BEGIN TRANSACTION`:

  ```ts
  try {
    const cleanup = await this.backupManager.cleanupBackups({
      mode: 'apply',
      includeInterrupted: false,
    });
    if (!cleanup.ok) {
      logger.warn('백업 보존 정리 미완료', {
        failedCount: cleanup.failedCount,
        skippedCount: cleanup.skippedCount,
        artifacts: cleanup.artifacts.filter(item => item.status !== 'deleted'),
      });
    }
  } catch (error) {
    const masked = error instanceof Error
      ? PIIMasker.maskError(error)
      : { message: String(error), name: 'Error' };
    logger.warn('백업 보존 정리 실패', { error: masked.message, errorName: masked.name });
  }
  ```

  Use the repository's existing error-normalization style; do not include the backup directory.

- [ ] **Step 4: Run GREEN**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  ```

  Expected: both files pass.

- [ ] **Step 5: Commit runner sequencing**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.ts packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts
  git commit -m "Keep migrations available when old-backup maintenance is incomplete" -m "Constraint: Validated backup creation still blocks migration on failure" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: migration-runner.spec.ts; backup-manager.spec.ts"
  ```

### T005 — Lock the no-pending-migration startup invariant

- [ ] T005 [P] [SUBAGENT] [US1] Add 100 repeated no-pending startup simulations proving zero automatic backup calls.

**Files:**

- Create: `packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.spec.ts`

**Interfaces:**

- Consumes: `migrateExistingDatabaseIfNeeded(db)` and the existing detector guard.
- Produces: regression evidence for FR-024/SC-007; no production API.

- [ ] **Step 1: Add the guard regression**

  Mock `MigrationDetector.detectPendingMigrations` to return `pendingMigrations: []` and spy on the
  `MigrationRunner` construction/backup boundary. Invoke initialization 100 times:

  ```ts
  for (let run = 0; run < 100; run += 1) {
    await migrateExistingDatabaseIfNeeded(db);
  }
  expect(runMigrations).not.toHaveBeenCalled();
  expect(createBackup).not.toHaveBeenCalled();
  ```

  Prefer module mocks already used by nearby initialization specs; do not alter production code if
  the existing guard passes.

- [ ] **Step 2: Run the focused test**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.spec.ts --reporter=default
  ```

  Expected: PASS 100 simulations with zero runner/backup calls. If it fails, fix only the guard in
  `init-migrate-existing.ts`, rerun, and include that file in the commit.

- [ ] **Step 3: Commit the invariant**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.spec.ts packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.ts
  git commit -m "Prevent idle startup from manufacturing migration backups" -m "Constraint: No backup exists without a pending migration" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: init-migrate-existing.spec.ts 100 startup simulations"
  ```

### T006 — User Story 1 review gate

- [ ] T006 [REVIEW] [US1] Review only the US1 diff and do not start US2 until retention selection, failure isolation, and no-pending startup evidence are accepted.

**Review evidence:**

```bash
git diff HEAD~3 -- packages/memento-core/src/infrastructure/database/sqlite
npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.spec.ts --reporter=default
```

**Checkpoint:** US1 independently bounds automatic files, preserves operator files, continues after
per-file cleanup failures, and creates nothing without pending migrations.

---

## Phase 4: User Story 2 — Produce Only Complete Standalone Backups (Priority: P1)

**Goal:** Both automatic and operator paths publish exactly one nonzero snapshot-size-matched,
full-integrity SQLite file after validation, and clean every known failure/interruption artifact.

**Independent Test:** Create a WAL database with committed uncheckpointed content, exercise success
and injected failures at every gate, and verify completed names appear only after validation while
failed attempts leave no silent `.db`, `-wal`, or `-shm` residue.

### T007 — Build the validated online-snapshot success path

- [ ] T007 [TDD] [SUBAGENT] [US2] Replace live-file copying with online backup, snapshot-relative size checks, standalone conversion, full integrity, sync, and non-overwriting publication.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts`

**Interfaces:**

- Consumes: `better-sqlite3` `db.backup()` metadata and strict names from T002.
- Produces:

  ```ts
  export interface BackupResult {
    backupPath: string;
    timestamp: Date;
    size: number;
    expectedSize: number;
    totalPages: number;
    integrityCheck: 'ok';
  }

  createBackup(
    db: Database.Database,
    migrationVersion?: string
  ): Promise<BackupResult>;
  ```

  A version produces an automatic name; absent version produces the established operator name.

- [ ] **Step 1: Write WAL success and publication-order tests**

  Use a real file database in WAL mode, insert committed content, and assert the final backup sees
  it. Spy on the validation gate and `linkSync`/`unlinkSync` order or inject filesystem failures via
  Vitest spies:

  ```ts
  expect(result.size).toBeGreaterThan(0);
  expect(result.size).toBe(result.expectedSize);
  expect(result.integrityCheck).toBe('ok');
  expect(backup.pragma('page_count', { simple: true })).toBe(result.totalPages);
  expect(backup.pragma('journal_mode', { simple: true })).toBe('delete');
  expect(existsSync(`${result.backupPath}-wal`)).toBe(false);
  expect(existsSync(`${result.backupPath}-shm`)).toBe(false);
  ```

  Assert the completed path does not exist while validation is deliberately paused/failing.

- [ ] **Step 2: Run RED**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  ```

  Expected: FAIL because automatic creation uses `copyFileSync`, lacks metadata/integrity gates, and
  writes directly to the completed name.

- [ ] **Step 3: Implement the minimum success pipeline**

  Keep it in `backup-manager.ts` and change the type-only `better-sqlite3` import to the runtime
  default import needed to open the unpublished destination:

  ```ts
  const sourcePageSize = db.pragma('page_size', { simple: true }) as number;
  const metadata = await db.backup(inProgressPath);
  if (metadata.remainingPages !== 0) throw new Error('backup-incomplete');

  const verify = new Database(inProgressPath);
  try {
    const checkpoint = verify.pragma('wal_checkpoint(TRUNCATE)')[0] as {
      busy: number;
      log: number;
      checkpointed: number;
    };
    if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
      throw new Error('backup-checkpoint-incomplete');
    }
    verify.pragma('journal_mode = DELETE');
    const journalMode = verify.pragma('journal_mode', { simple: true }) as string;
    const totalPages = verify.pragma('page_count', { simple: true }) as number;
    const pageSize = verify.pragma('page_size', { simple: true }) as number;
    const integrity = verify.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (
      journalMode !== 'delete' ||
      totalPages !== metadata.totalPages ||
      pageSize !== sourcePageSize ||
      integrity.length !== 1 ||
      integrity[0]?.integrity_check !== 'ok'
    ) {
      throw new Error('backup-validation-failed');
    }
  } finally {
    verify.close();
  }

  const expectedSize = metadata.totalPages * sourcePageSize;
  const size = fs.statSync(inProgressPath).size;
  if (size === 0 || size !== expectedSize) throw new Error('backup-size-mismatch');

  const fd = fs.openSync(inProgressPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.linkSync(inProgressPath, completedPath);
  fs.unlinkSync(inProgressPath);
  ```

  Use `randomUUID()` for `.memory-backup-partial-<uuid>.db`. Use `db.name` as the source of truth.
  T004 already makes `MigrationRunner` resolve its default backup directory from that opened
  database, not a different global `DB_PATH`. Do not checkpoint or unlink live-database sidecars.

- [ ] **Step 4: Run GREEN and core type-check**

  Run the T002 Step 4 commands.

  Expected: all backup-manager tests pass and types match the declared interface.

- [ ] **Step 5: Commit the success boundary**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Publish migration backups only after SQLite proves a complete snapshot" -m "Constraint: WAL-safe backup must use the installed online backup API" -m "Rejected: live main-file copy and rename | they omit WAL state or overwrite collisions" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: backup-manager.spec.ts; @memento/core type-check"
  ```

### T008 — Close every handled backup failure exit

- [ ] T008 [TDD] [US2] Remove the complete current-attempt artifact set on handled failures, refuse collisions, and keep crash leftovers distinguishable without sweeping other active partials.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts`

**Interfaces:**

- Consumes: T007 in-progress/final name grammars and validation pipeline.
- Produces: one internal attempt cleanup path covering `.db`, `-wal`, and `-shm`; thrown errors name
  only safe artifact IDs and failure stages.

- [ ] **Step 1: Add one failure-table test covering every gate**

  Inject failures at backup write, zero/size/page mismatch, full integrity, checkpoint, sidecar
  removal, file sync, hard-link collision, and post-link partial unlink. For example, freeze the
  completed timestamp, create the colliding final file, and prove it is preserved:

  ```ts
  it('refuses a completed-name collision without overwriting it', async () => {
    const isoSpy = vi.spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-08-23T00:00:00.000Z');
    const completed = join(
      backupsDir,
      'memory-backup-2.0-2026-08-23T00-00-00-000Z.db'
    );
    writeFileSync(completed, 'existing');

    await expect(backupManager.createBackup(db, '2.0')).rejects.toThrow(/collision/);
    expect(readFileSync(completed, 'utf8')).toBe('existing');
    expect(readdirSync(backupsDir).filter(name => name.includes('partial'))).toEqual([]);
    isoSpy.mockRestore();
  });
  ```

  Give every remaining failure point its own test with the same three assertions: rejection contains
  the documented safe reason, the attempt's `.db`/`-wal`/`-shm` set is absent, and serialized error
  output omits `testRoot`. For an injected cleanup failure, assert the thrown result identifies the
  remaining basename and never claims clean success. Model a process crash by manually creating a
  valid completed hard link plus its strict partial; assert their names are disjoint and routine
  `cleanupBackups({ mode: 'apply', includeInterrupted: false })` preserves the partial. T012 owns its
  later explicit stopped-server removal.

- [ ] **Step 2: Run RED**

  Run the T007 focused test command.

  Expected: one or more injected exits leave residue, overwrite/unlink a collision, or leak paths.

- [ ] **Step 3: Centralize attempt cleanup and collision handling**

  Keep the helper private and bounded to the strict attempt basename:

  ```ts
  function isEnoent(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }

  function removeAttemptArtifacts(inProgressPath: string): string[] {
    const remaining: string[] = [];
    for (const candidate of [inProgressPath, `${inProgressPath}-wal`, `${inProgressPath}-shm`]) {
      try {
        fs.unlinkSync(candidate);
      } catch (error) {
        if (!isEnoent(error)) remaining.push(basename(candidate));
      }
    }
    return remaining;
  }
  ```

  In a handled post-link failure, try to remove both current-attempt link names and report residue.
  Do not sweep pre-existing strict partials during creation or routine retention: they may belong to
  an overlapping active operator backup. T012 performs interrupted-attempt recovery only when the
  explicit cleanup prerequisite has stopped backup activity.

- [ ] **Step 4: Run GREEN and the full core migration subset**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts packages/memento-core/src/infrastructure/database/sqlite/migration/migration-detector.spec.ts --reporter=default
  npm run type-check -w @memento/core
  ```

  Expected: all commands exit 0 and no test leaves backup artifacts.

- [ ] **Step 5: Commit failure closure**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Make failed backup attempts leave no silent restorable identity" -m "Constraint: Sidecars are touched only after all backup handles and checkpoint work close" -m "Confidence: high" -m "Scope-risk: moderate" -m "Directive: Keep completed and partial filename grammars disjoint" -m "Tested: injected backup failure matrix; core migration subset; type-check"
  ```

### T009 — Prove backup failure blocks the dependent migration

- [ ] T009 [P] [SUBAGENT] [US2] Add a runner regression that rejects creation/validation failure before `migration.up()` and the transaction begin.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts`

**Interfaces:**

- Consumes: thrown failure from `BackupManager.createBackup`.
- Produces: FR-016/SC-006 regression evidence; no new runtime API.

- [ ] **Step 1: Add the regression**

  ```ts
  vi.spyOn(runner.getBackupManager(), 'createBackup')
    .mockRejectedValue(new Error('backup-integrity-failed'));

  const result = await runner.runMigration(testMigration);
  expect(result.success).toBe(false);
  expect(result.error).toContain('backup-integrity-failed');
  expect(testMigration.up).not.toHaveBeenCalled();
  expect(db.inTransaction).toBe(false);
  ```

- [ ] **Step 2: Run and preserve the existing implementation if green**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts --reporter=default
  ```

  Expected: PASS because the existing outer runner boundary already stops before `BEGIN`; change
  production code only if the test demonstrates otherwise.

- [ ] **Step 3: Commit the regression evidence**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts
  git commit -m "Lock migration execution behind a verified backup result" -m "Constraint: Creation and validation failures block the dependent migration" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: migration-runner.spec.ts"
  ```

### T010 — Route the existing operator backup command through the shared manager

- [ ] T010 [P] [TDD] [SUBAGENT] [US2] Export `BackupManager`, preserve no-argument `db:backup`, and replace the script's duplicate validation/cleanup ordering.

**Files:**

- Modify: `packages/memento-core/src/index.ts`
- Modify: `scripts/backup-memory-db.mjs`
- Create: `scripts/__tests__/backup-memory-db.spec.ts`

**Interfaces:**

- Consumes: `BackupManager.createBackup(db)` from T007/T008 and existing `openDb`/`DB_PATH` behavior.
- Produces: additive root exports for `BackupManager`, `BackupResult`, `CleanupOptions`, and
  `CleanupReport`; unchanged no-argument CLI keys `ok`, `dbPath`, `backupPath`, and `memory_item`,
  preserving `quick_check: "ok"` as a compatibility alias and adding `integrity_check: "ok"`.

- [ ] **Step 1: Write subprocess RED tests for operator backup**

  Create a temporary DB and invoke the script with an absolute `DB_PATH`. Assert one standalone
  operator name, full-integrity success, no sidecars/partials, safe failure output, and collision
  refusal without deleting the existing destination:

  ```ts
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({
    ok: true,
    quick_check: 'ok',
    integrity_check: 'ok',
  });
  expect(basename(output.backupPath)).toMatch(/^memory-backup-\d{4}-/);
  expect(readdirSync(backupsDir).filter(name => /-wal$|-shm$|partial/.test(name))).toEqual([]);
  ```

- [ ] **Step 2: Run RED after building core**

  ```bash
  npm run build -w @memento/core
  npx vitest run scripts/__tests__/backup-memory-db.spec.ts --reporter=default
  ```

  Expected: FAIL because the script owns a separate quick-check path and deletes name collisions.

- [ ] **Step 3: Export and delegate**

  Add only the existing class/types to `packages/memento-core/src/index.ts`. Keep argument-free script
  behavior and memory count, but delegate creation:

  ```js
  const manager = new BackupManager(path.join(path.dirname(dbPath), 'backups'));
  const backup = await manager.createBackup(source);
  const result = {
    ok: true,
    dbPath,
    backupPath: backup.backupPath,
    quick_check: backup.integrityCheck,
    integrity_check: backup.integrityCheck,
    memory_item: memoryItemCount,
  };
  ```

  Failure JSON contains a safe stage/reason and hint, not `dbPath`, `backupPath`, or raw error paths.

- [ ] **Step 4: Run GREEN**

  Run the T010 Step 2 commands plus `npm run type-check`.

  Expected: operator subprocess tests and repository type-check pass.

- [ ] **Step 5: Commit operator reuse**

  ```bash
  git add packages/memento-core/src/index.ts scripts/backup-memory-db.mjs scripts/__tests__/backup-memory-db.spec.ts
  git commit -m "Give operator backups the same validated publication boundary as migrations" -m "Constraint: Preserve the existing db:backup invocation and successful output keys" -m "Rejected: Duplicate script validation | it recreates sidecars after early cleanup" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: backup-memory-db.spec.ts; build; type-check"
  ```

### T011 — User Story 2 review gate

- [ ] T011 [REVIEW] [US2] Review the backup state machine, WAL safety, collision behavior, and every injected failure before exposing backlog deletion.

**Review evidence:**

```bash
git diff HEAD~4 -- packages/memento-core/src/index.ts packages/memento-core/src/infrastructure/database/sqlite/migration scripts/backup-memory-db.mjs scripts/__tests__/backup-memory-db.spec.ts
npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts scripts/__tests__/backup-memory-db.spec.ts --reporter=default
```

**Checkpoint:** US2 independently creates a complete standalone automatic or operator snapshot,
blocks migration on creation/validation failure, refuses overwrite, and reports any cleanup residue.

---

## Phase 5: User Story 3 — Safely Clean the Existing Backlog (Priority: P2)

**Goal:** Let operators preview and explicitly apply the same cleanup rules to existing files with
exact counts/bytes, safe revalidation, failure continuation, and idempotence.

**Independent Test:** Against a 6,900-entry tiny fixture, preview and apply select the same artifacts,
preserve live/operator/unknown paths, reconcile every result, and make the second apply empty.

### T012 — Complete invalid-artifact and TOCTOU safety coverage

- [ ] T012 [TDD] [SUBAGENT] [US3] Select zero-byte recognized backups, recognized sidecars, and strict partials while preserving links, directories, live sidecars, and changed candidates.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts`

**Interfaces:**

- Consumes: `cleanupBackups` from T003 and attempt grammar from T008.
- Produces: the complete selection reasons and outcome details documented in
  `contracts/backup-cleanup-cli.md`.

- [ ] **Step 1: Add RED cases for the destructive boundary**

  Test zero-byte automatic/operator files, completed/partial `-wal` and `-shm`, live DB sidecars,
  symlinks pointing outside, directories with matching names, disappearing files, and candidates
  whose type/size/mtime/inode changes between inspection and unlink. Include one canonical v4 UUID
  partial and near-miss non-UUID names. Assert routine cleanup preserves every partial, explicit
  `cleanupBackups({ mode: 'apply', includeInterrupted: true })` selects only the canonical partial,
  and later candidates still run after one failure.

  ```ts
  expect(selectedReasons).toEqual(expect.arrayContaining([
    'zero-byte-backup',
    'orphaned-sidecar',
    'interrupted-attempt',
  ]));
  expect(report.artifacts).toContainEqual(expect.objectContaining({
    status: 'skipped',
    detail: 'changed-before-delete',
  }));
  expect(existsSync(outsideTarget)).toBe(true);
  expect(existsSync(`${liveDbPath}-wal`)).toBe(true);
  ```

- [ ] **Step 2: Run RED**

  Run the T007 focused test command.

  Expected: FAIL on one or more invalid-artifact, link, or changed-candidate cases.

- [ ] **Step 3: Extend only the existing classifier/apply loop**

  Associate a sidecar only when removing `-wal`/`-shm` leaves a base matching a completed or strict
  partial backup grammar. Gate `interrupted-attempt` selection on `includeInterrupted === true`.
  Call `lstat` immediately before `unlink`, require `isFile()` and the T003 fingerprint, and use safe
  `detail` values. Do not introduce recursive traversal or a filesystem abstraction.

- [ ] **Step 4: Run GREEN**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts --reporter=default
  npm run type-check -w @memento/core
  ```

  Expected: all safety cases and type-check pass.

- [ ] **Step 5: Commit the cleanup safety boundary**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.ts packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Constrain backlog deletion to revalidated owned backup artifacts" -m "Constraint: Trusted direct-child directory with no concurrent restore" -m "Rejected: Symlink following and recursive cleanup | they expand destructive scope" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: backup-manager cleanup safety matrix; core type-check"
  ```

### T013 — Prove 6,900-artifact parity, exact totals, and idempotence

- [ ] T013 [P] [TDD] [US3] Add a tiny 6,900-entry fixture matching the reported backlog shape and verify preview/apply/second-apply reconciliation.

**Files:**

- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts`

**Interfaces:**

- Consumes: final `cleanupBackups` behavior.
- Produces: SC-003/SC-004 scale evidence without allocating 5.5 GB.

- [ ] **Step 1: Generate the fixture in the test body**

  Create tiny payloads with exact categories totaling 6,900 entries:

  ```ts
  const counts = {
    expiredAutomatic: 6835,
    currentAutomatic: 20,
    operator: 20,
    zeroByte: 9,
    sidecar: 16,
  } as const;
  expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(6900);
  ```

  Use one-byte recognized-name placeholders and zero-byte invalid artifacts; split the nine
  zero-byte files across recognized automatic and operator names. Assert actual bytes from `lstat`,
  not a simulated 5.5 GB allocation.

- [ ] **Step 2: Assert preview/apply parity and second-apply emptiness**

  ```ts
  expect(preview.selectedCount).toBe(6835 + 9 + 16);
  expect(preview.selectedBytes).toBe(6835 + 16);
  expect(preview.inspectedCount).toBe(6900);
  expect(preview.ignoredCount).toBe(20 + 20);
  expect(preview.artifacts).toHaveLength(preview.selectedCount);
  expect(apply.artifacts.map(item => [item.id, item.reason]).sort())
    .toEqual(preview.artifacts.map(item => [item.id, item.reason]).sort());
  expect(apply.selectedCount).toBe(apply.deletedCount);
  expect(apply.reclaimedBytes).toBe(6835 + 16);
  expect(apply.inspectedCount).toBe(apply.selectedCount + apply.ignoredCount);
  expect(apply.artifacts).toHaveLength(apply.selectedCount);
  expect(secondApply).toMatchObject({
    inspectedCount: 40,
    selectedCount: 0,
    deletedCount: 0,
    reclaimedBytes: 0,
    ignoredCount: 40,
  });
  ```

- [ ] **Step 3: Run the focused scale test twice**

  ```bash
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts -t "6900" --reporter=default
  npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts -t "6900" --reporter=default
  ```

  Expected: both runs pass with exact counts and no fixture residue. If performance fails, optimize
  the existing one-pass loop only; do not add concurrency or a cache without measurement.

- [ ] **Step 4: Commit scale evidence**

  ```bash
  git add packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts
  git commit -m "Prove backlog cleanup reconciles the reported artifact scale exactly" -m "Constraint: Scale evidence uses tiny files instead of allocating 5.5 GB" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: 6900-artifact test twice"
  ```

### T014 — Add preview-first cleanup mode to the existing operator CLI

- [ ] T014 [P] [TDD] [US3] Implement strict `--cleanup [--apply]` parsing, JSON reporting, exit codes, and the `db:backup:cleanup` npm alias.

**Files:**

- Modify: `scripts/__tests__/backup-memory-db.spec.ts`
- Modify: `scripts/backup-memory-db.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: `BackupManager.cleanupBackups({ mode, includeInterrupted: true })` and the contract in
  `specs/065-db-backup-retention/contracts/backup-cleanup-cli.md`.
- Produces: `npm run db:backup:cleanup` preview and
  `npm run db:backup:cleanup -- --apply` apply; exit 0 on complete result and exit 1 on usage,
  scan, skipped, or failed result.

- [ ] **Step 1: Add subprocess RED tests for argument and JSON contracts**

  Test no flags still create a backup; `--cleanup` previews without inode changes; exact
  `--cleanup --apply` deletes selected files; `--apply` alone and unknown/extra flags exit 1 without
  deletion; failed/skipped apply exits 1. Make the sibling `backups` path a regular file in a
  separate fixture and assert scan failure exits 1 with `{ ok: false, error: 'scan-failed' }`
  without printing `DB_PATH` or the temporary root. Assert JSON keys and basenames exactly.

  ```ts
  expect(preview.status).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({ mode: 'preview', deletedCount: 0 });
  expect(apply.status).toBe(0);
  expect(JSON.parse(apply.stdout).mode).toBe('apply');
  expect(usageError.status).toBe(1);
  expect(readdirSync(backupsDir)).toEqual(beforeUsageError);
  ```

- [ ] **Step 2: Run RED**

  ```bash
  npm run build -w @memento/core
  npx vitest run scripts/__tests__/backup-memory-db.spec.ts --reporter=default
  ```

  Expected: FAIL because cleanup flags and npm alias are absent.

- [ ] **Step 3: Implement exact parsing and delegation**

  ```js
  const args = process.argv.slice(2);
  const cleanup = args[0] === '--cleanup';
  const apply = cleanup && args[1] === '--apply' && args.length === 2;
  const valid = args.length === 0 ||
    (cleanup && (args.length === 1 || apply));

  if (!valid) failUsage();
  if (cleanup) {
    const report = await manager.cleanupBackups({
      mode: apply ? 'apply' : 'preview',
      includeInterrupted: true,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
  ```

  Register only:

  ```json
  "db:backup:cleanup": "node scripts/backup-memory-db.mjs --cleanup"
  ```

- [ ] **Step 4: Run GREEN**

  ```bash
  npm run build -w @memento/core
  npx vitest run scripts/__tests__/backup-memory-db.spec.ts --reporter=default
  ```

  Expected: build and CLI tests pass. T015 documents the new alias before the US3 gate runs
  `docs:verify-npm-scripts`.

- [ ] **Step 5: Commit the CLI contract**

  ```bash
  git add scripts/backup-memory-db.mjs scripts/__tests__/backup-memory-db.spec.ts package.json
  git commit -m "Require explicit operator intent before deleting backup backlog artifacts" -m "Constraint: Cleanup defaults to preview and emits one reconciled JSON document" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: backup-memory-db.spec.ts; core build" -m "Not-tested: docs npm-script verification waits for T015 documentation"
  ```

### T015 — Document root causes, command safety, and deployment usage

- [ ] T015 [P] [SUBAGENT] [US3] Document the new cleanup alias, preview/apply prerequisite, reproduced artifact causes, and unchanged operator-backup contract.

**Files:**

- Modify: `docs/agents/commands.md`
- Modify: `docs/operations/ko/docker-deploy-procedure.md`
- Modify: `docs/operations/ko/scripts-index.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the exact command/output contract from T014 and root-cause evidence from T007/T008/T010.
- Produces: operator instructions that satisfy FR-001 and make the new npm alias discoverable to
  `docs:verify-npm-scripts`.

- [ ] **Step 1: Add concise operational documentation**

  Document these exact commands:

  ```bash
  npm run db:backup
  npm run db:backup:cleanup
  npm run db:backup:cleanup -- --apply
  ```

  State that cleanup apply requires the MCP server, restore, and other cleanup processes to be
  stopped; `DB_PATH` must be absolute and does not expand `~`; preview is default; operator backups
  remain; paths are not included in failure reports. Record the three reproduced causes: migration
  main-file copy, operator validation after early sidecar cleanup, and uncalled broad `mtime` cleanup.

- [ ] **Step 2: Verify documentation and links**

  ```bash
  npm run docs:verify-npm-scripts
  npm run docs:audit-links
  ```

  Expected: both commands exit 0.

- [ ] **Step 3: Commit operator documentation**

  ```bash
  git add docs/agents/commands.md docs/operations/ko/docker-deploy-procedure.md docs/operations/ko/scripts-index.md CHANGELOG.md
  git commit -m "Make destructive backup cleanup verifiable before operators apply it" -m "Constraint: Preview is default and apply requires a stopped trusted backup directory" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: docs npm-script verification; markdown link audit"
  ```

### T016 — User Story 3 review gate

- [ ] T016 [REVIEW] [US3] Review the 6,900-entry evidence, CLI contract, destructive path boundary, and operator documentation before cross-cutting verification.

**Review evidence:**

```bash
npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts scripts/__tests__/backup-memory-db.spec.ts --reporter=default
npm run docs:verify-npm-scripts
npm run docs:audit-links
```

**Checkpoint:** US3 independently previews without changes, applies only with explicit intent,
preserves protected paths, reconciles every result, and makes a second apply empty.

---

## Phase 6: Polish and Cross-Cutting Verification

**Purpose:** Review the integrated implementation against all 24 requirements and collect fresh
repository-wide completion evidence.

### T017 — Run superspec code review and resolve all blocking findings

- [ ] T017 [REVIEW] [SUBAGENT] Run `$speckit-superspec-review specs/065-db-backup-retention/spec.md`, fix every confidence-qualified blocking finding with a RED/GREEN regression, and repeat until no blocker remains.

**Files:**

- Review: every file listed in T001–T015.
- Modify: only files directly implicated by accepted review findings.

**Required review dimensions:**

- WAL snapshot completeness and exact size/page/integrity gates.
- Publication visibility, collision refusal, partial recovery, and sidecar timing.
- Automatic/operator namespace separation and fixed UTC cutoff.
- Direct-child `lstat` revalidation and per-artifact reconciliation.
- Backup-vs-retention failure isolation and safe output.
- Preview/apply CLI compatibility and 6,900-entry evidence.

For each accepted finding, add the smallest failing test, run it RED, apply the minimal fix, and run
it GREEN. Commit fixes separately with Lore trailers and the exact tested command.

### T018 — Run final quality gates and rebuild graphify

- [ ] T018 [REVIEW] Execute the full validation sequence, inspect generated architecture evidence, and leave zero known errors before completion.

**Files:**

- Verify: all changed source, test, documentation, and package metadata files.
- Generate locally only: `graphify-out/GRAPH_REPORT.md` and related `graphify-out/` files.

- [ ] **Step 1: Run the focused feature suite**

  ```bash
  npx vitest run \
    packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts \
    packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts \
    packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.spec.ts \
    scripts/__tests__/backup-memory-db.spec.ts \
    --reporter=default
  ```

  Expected: all feature tests pass, including the 6,900-entry and 100-startup cases.

- [ ] **Step 2: Run mandatory repository gates**

  ```bash
  npm run docs:verify-npm-scripts
  npm run docs:audit-links
  npm run lint
  npm run type-check
  npm test
  ```

  Expected: every command exits 0. A failure blocks completion and returns to the owning TDD task.

- [ ] **Step 3: Rebuild and inspect graphify**

  ```bash
  python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
  test -f graphify-out/GRAPH_REPORT.md
  git status --short
  ```

  Expected: the report exists, no new prohibited dependency direction or cycle is reported, and
  `graphify-out/` is not staged.

- [ ] **Step 4: Reproduce the disposable CLI quickstart**

  Follow `specs/065-db-backup-retention/quickstart.md` with an absolute disposable `DB_PATH`.
  Expected: backup and preview exit 0, apply reconciles the preview, and the second apply reports
  zero selected/deleted artifacts and zero reclaimed bytes.

- [ ] **Step 5: Commit only final verification fixes, if any**

  If no file changed, do not create an empty commit. If verification required a fix, use its own
  RED/GREEN evidence and a Lore message; never stage `graphify-out/`.

**Final checkpoint:** No pending task, no known error, all focused and mandatory gates green, all
24 functional requirements mapped below, and fresh verification evidence recorded.

---

## Dependencies and Execution Order

### Phase dependencies

- **Phase 1 — Setup**: starts immediately.
- **Phase 2 — Foundational**: depends on T001 and blocks every user story.
- **Phase 3 — US1**: T003 depends on T002; T004 depends on T003; T005 depends on T002 and may run in
  parallel with T004; T006 waits for T003–T005.
- **Phase 4 — US2**: starts after T006. T007 → T008 are sequential in `backup-manager.ts`; after
  T008, T009 and T010 may run in parallel because they own different files; T011 waits for both.
- **Phase 5 — US3**: starts after T011. T012 → T013 are sequential in `backup-manager.spec.ts`;
  T014 depends on T012; T015 may run in parallel once T014's exact command contract is frozen; T016
  waits for T012–T015.
- **Phase 6 — Polish**: T017 depends on T016; T018 depends on all accepted T017 findings being fixed.

### Task dependency graph

```text
T001 -> T002 -> T003 -> T004 ----\
                 \----> T005 ----> T006 -> T007 -> T008 -> T009 --\
                                                      \-> T010 ----> T011
T011 -> T012 -> T013 ----\
          \----> T014 -> T015 ----> T016 -> T017 -> T018
```

### Parallel opportunities

- T004 and T005 may run concurrently after T003/T002 respectively; they touch runner vs
  initialization files.
- T009 and T010 may run concurrently after T008; they touch runner regression vs public export/CLI.
- T015 is delegable after T014 freezes the command contract; it owns documentation only.
- `[SUBAGENT]` without `[P]` means delegation is safe but execution remains dependency-ordered.
- Never run two tasks that modify `backup-manager.ts`, `backup-manager.spec.ts`, or
  `backup-memory-db.mjs` concurrently.

---

## Requirements Coverage

| Requirement | Owning tasks |
| --- | --- |
| FR-001 reproducible causes | T007, T008, T010, T015 |
| FR-002 fixed 30 days | T002, T003 |
| FR-003 post-success automatic retention | T003, T004 |
| FR-004 protected paths/operator backups | T003, T012 |
| FR-005 snapshot size + integrity | T007, T010 |
| FR-006 ordering/checkpoint/closure | T007, T008 |
| FR-007 failed-attempt artifact cleanup | T008, T010 |
| FR-008 one standalone artifact | T007, T008, T010 |
| FR-009 no-change preview | T003, T014 |
| FR-010 shared selection/report totals | T003, T013, T014 |
| FR-011 expired/zero/sidecar cleanup | T003, T012, T013 |
| FR-012 idempotence | T013, T014 |
| FR-013 observable safe failures | T003, T004, T008, T010, T014 |
| FR-014 automated regression matrix | T003–T005, T007–T010, T012–T014 |
| FR-015 nonblocking retention failure | T004 |
| FR-016 blocking backup failure | T009 |
| FR-017 delayed/non-overwriting publication | T007, T008 |
| FR-018 interrupted-attempt recovery | T008, T012 |
| FR-019 explicit apply | T014 |
| FR-020 immediate deletion revalidation | T003, T012 |
| FR-021 preserve unverifiable historical operator backups | T003, T012 |
| FR-022 continue and report incomplete maintenance | T003, T004, T012, T014 |
| FR-023 one UTC filename cutoff | T002, T003 |
| FR-024 no pending migration backup | T005 |

| Success criterion | Evidence task |
| --- | --- |
| SC-001 automatic expiry/operator preservation | T003, T004 |
| SC-002 validated success/failure residue | T007–T010 |
| SC-003 6,900 preview/apply/idempotence | T013 |
| SC-004 nine zero-byte/sixteen sidecars | T013 |
| SC-005 report reconciliation | T003, T012–T014 |
| SC-006 backup vs retention failure isolation | T004, T009 |
| SC-007 100 idle startups | T005 |

---

## Implementation Strategy

### MVP first

1. Complete T001–T002.
2. Complete T003–T005 and pass T006: automatic backup growth is bounded without operator deletion.
3. Stop and independently verify US1 before changing backup publication.

### Incremental delivery

1. **US1** bounds future automatic growth.
2. **US2** makes both creators safe, standalone, and failure-clean.
3. **US3** recovers the existing backlog with preview-first operator control.
4. **Polish** performs superspec review, mandatory gates, graphify, and disposable CLI validation.

### Execution notes

- Use a fresh agent for each `[SUBAGENT]` task and review its diff/evidence before continuing.
- At each `[REVIEW]` gate, stop downstream execution until findings are resolved; do not edit while
  reviewing.
- Do not broaden scope to restore behavior, legacy embedding/daily backup scripts, configurable
  retention, count caps, remote storage, or unrelated issues #804/#810.
- Prefer deletion/reuse over new helpers. Keep private helpers in `backup-manager.ts` unless the file
  cannot remain reviewable after the T007/T008 implementation; no speculative split is authorized.
