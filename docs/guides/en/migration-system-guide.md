# Migration System Guide

Database schemas inevitably evolve. Without a structured process for managing changes, schema updates can lead to data loss or server startup failures in production environments. Memento addresses this with a formal migration system that provides version tracking, automatic backups, and pre/post validation.

After changing the schema, also update the relevant sections of [database-design.md](../../architecture/en/database-design.md) — tables, indexes, and migration history.

## Core Components

The migration system lives under `packages/memento-core/src/infrastructure/database/database/migration/` and is composed of five components.

**MigrationRunner** is the execution engine. It runs a single migration inside a transaction, attempts automatic rollback on failure, and returns a `MigrationResult` object with success status, timing, and any error.

**MigrationDetector** scans migration files automatically and determines which versions have already been applied and which are still pending. A single call to `detectPendingMigrations(db)` returns the current schema version along with the list of unapplied migrations.

**BackupManager** creates automatic backups before a migration runs and manages restoration. In production environments, always enable the backup option.

**SchemaVersionManager** records each applied migration in the database, tracking the current schema version.

**MigrationLogger** writes a log of every step — start, completion, and failure — to a log file.

## Migration File Location

Canonical migrations live at:

```
packages/memento-core/src/infrastructure/database/database/migration/migrations/
```

Files follow the naming convention `{version}-{name}.ts`. Three-digit zero-padded version numbers are recommended.

```
002-mirix-schema-expansion.ts
003-consolidation-score-fields.ts
014-procedural-version-indexes.ts
```

Note that two directories exist inside the same `database/` path: `migration/migrations/` (the current canonical system) and `migrations/` (legacy SQL files used for initial schema setup). All new migrations must go into `migration/migrations/`.

## The Migration Interface

Every migration file must implement the following interface.

```typescript
export interface Migration {
  version: string;      // e.g. "014" — three-digit format recommended
  name: string;         // e.g. "procedural-version-indexes"
  description: string;  // human-readable summary of the change

  up(db: Database.Database): Promise<void>;             // apply the migration
  down(db: Database.Database): Promise<void>;           // revert if possible
  validateBefore(db: Database.Database): Promise<void>; // verify preconditions
  validateAfter(db: Database.Database): Promise<void>;  // verify the change was applied
}
```

Implementing `validateBefore` and `validateAfter` is strongly recommended, not optional. `validateBefore` should check for duplicate application; if the column or index already exists, it should throw an error rather than silently continuing.

## Writing a Migration

```typescript
import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class AddViewCountColumn implements Migration {
  version = '015';
  name = 'add-view-count-column';
  description = 'Add view_count column to memory_item table';

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      ALTER TABLE memory_item
      ADD COLUMN view_count INTEGER DEFAULT 0
    `);
  }

  async down(db: Database.Database): Promise<void> {
    // SQLite does not support ALTER TABLE DROP COLUMN.
    // For column removal, a full table recreation is required.
    // In most cases, restoring from the BackupManager is safer.
  }

  async validateBefore(db: Database.Database): Promise<void> {
    const cols = db.prepare("PRAGMA table_info(memory_item)").all() as Array<{ name: string }>;
    if (cols.some(c => c.name === 'view_count')) {
      throw new Error('view_count column already exists — preventing duplicate migration');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const cols = db.prepare("PRAGMA table_info(memory_item)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'view_count')) {
      throw new Error('view_count column was not created');
    }
  }
}

export default AddViewCountColumn;
```

## Execution Flow

When `MigrationRunner.runMigration(migration, options)` is called, the following steps happen in order.

1. `BackupManager` creates an automatic backup if the option is enabled.
2. `SchemaVersionManager` reads the current schema version.
3. `validateBefore(db)` runs to verify preconditions.
4. `up(db)` runs inside a transaction.
5. `validateAfter(db)` runs to verify the change was applied correctly.
6. On success, the schema version record is written.
7. On failure, the transaction is rolled back automatically if `autoRollback` is enabled.
8. `MigrationLogger` records every step.

## Running Migrations

```bash
npm run db:migrate           # run all pending migrations
npm run db:check-migration   # check migration status
npm run db:init              # initialize the DB schema (first run only)
```

## Programmatic Usage

For automation scripts or server initialization code, use the following pattern.

```typescript
import Database from 'better-sqlite3';
import { MigrationDetector } from './migration-detector.js';
import { MigrationRunner } from './migration-runner.js';

const db = new Database(process.env.DB_PATH ?? '~/.memento/memory.db');
const detector = new MigrationDetector();
const runner = new MigrationRunner(db);

const detection = await detector.detectPendingMigrations(db);

if (detection.pendingMigrations.length === 0) {
  console.log('No pending migrations');
} else {
  for (const detected of detection.pendingMigrations) {
    const result = await runner.runMigration(detected.migration, {
      createBackup: true,
      autoRollback: true,
      validate: true,
    });

    if (!result.success) {
      console.error(`Migration failed: ${result.name}`, result.error);
      break;
    }
  }
}

db.close();
```

## Important Constraints

SQLite does not support all DDL operations that other databases allow. Column deletion and type changes require creating a new table, copying data, and replacing the original. Because of this, once a migration has been applied it must not be modified — if a correction is needed, add a new migration version.

Migration writing checklist:

- Implement the `Migration` interface (version, name, description, up, down, validateBefore, validateAfter)
- Verify the version number does not conflict with existing migrations
- Implement duplicate-application prevention in `validateBefore`
- Verify the change was actually applied in `validateAfter`
- File name follows the `{version}-{name}.ts` convention
- Class is exported as `default export` or named export
