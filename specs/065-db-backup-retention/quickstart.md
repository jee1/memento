# Quickstart Validation: Database Backup Retention and Artifact Cleanup

## Prerequisites

- Node.js 24 and npm 10+
- Dependencies installed with `npm install`
- A built workspace before invoking the operator script: `npm run build`
- Temporary test databases only for manual validation
- MCP server and restore operations stopped before cleanup apply

## 1. Establish the focused baseline

```bash
npx vitest run \
  packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts \
  packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts \
  packages/memento-core/src/infrastructure/database/sqlite/migration/migration-detector.spec.ts \
  --reporter=basic
```

Before implementation the existing focused baseline is 3 files and 25 passing tests. New tests
must first fail for the missing safety/retention behavior, then pass after the minimal implementation.

## 2. Run the feature tests

```bash
npx vitest run \
  packages/memento-core/src/infrastructure/database/sqlite/migration/backup-manager.spec.ts \
  packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts \
  packages/memento-core/src/infrastructure/database/sqlite/init-migrate-existing.spec.ts \
  scripts/__tests__/backup-memory-db.spec.ts \
  --reporter=basic
```

The suite must prove:

- a WAL-mode online snapshot is nonzero, page/byte matched, full-integrity checked, standalone, and
  published only after validation;
- injected write, zero-size, size mismatch, integrity, sidecar cleanup, and name-collision failures
  leave no completed identity and block the dependent migration;
- retention failure leaves the new backup usable and permits migration;
- automatic timestamp cutoff, operator preservation, future/boundary/invalid names, symlinks,
  directories, per-file failures, and immediate revalidation behave as specified;
- a 6,900-file tiny fixture has exact preview/apply counts and bytes and an empty second apply;
- 100 no-pending startup simulations create zero automatic backups;
- cleanup CLI default preview, explicit apply, exit codes, and safe output match the
  [CLI contract](./contracts/backup-cleanup-cli.md).

## 3. Manually verify preview/apply on a disposable database

Create an absolute disposable database and seed recognized stale artifacts so preview/apply has
observable work. Do not use a production database.

```bash
task_db_root="$(mktemp -d)"
export DB_PATH="$task_db_root/memory.db"
node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database(process.env.DB_PATH); db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)'); db.close();"
mkdir -p "$task_db_root/backups"
printf x > "$task_db_root/backups/memory-backup-2.0-2020-01-01T00-00-00-000Z.db"
: > "$task_db_root/backups/memory-backup-2020-01-01T00-00-00-000Z.db"
printf x > "$task_db_root/backups/memory-backup-2.0-2020-01-01T00-00-00-000Z.db-wal"
npm run db:backup
npm run db:backup:cleanup
npm run db:backup:cleanup -- --apply
npm run db:backup:cleanup -- --apply
```

Expected results:

1. Backup exits 0 and publishes one nonzero standalone operator backup.
2. Preview exits 0, selects the three seeded stale artifacts, and changes no inode or byte total.
3. Apply selects the same unchanged artifacts and reconciles every selected item to deleted,
   skipped, or failed.
4. A successful second apply reports `selectedCount: 0`, `deletedCount: 0`, and
   `reclaimedBytes: 0`.

## 4. Run repository quality gates

```bash
npm run docs:verify-npm-scripts
npm run lint
npm run type-check
npm test
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Inspect `graphify-out/GRAPH_REPORT.md` after the rebuild. `graphify-out/` is generated locally and
must not be committed.

## Stop condition

The feature is ready to hand off only when all focused and repository-wide gates pass, the CLI
contract examples are reproduced on a disposable database, no failure-path test leaves an
unreported artifact, and the 6,900-file fixture reconciles exactly.
