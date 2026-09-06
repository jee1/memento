# Contract: Migration run-scoped backup

## API (unchanged surface)

```ts
interface MigrationOptions {
  createBackup?: boolean; // default true
  autoRollback?: boolean;
  validate?: boolean;
}

class MigrationRunner {
  runMigration(migration: Migration, options?: MigrationOptions): Promise<MigrationResult>;
  runMigrations(migrations: Migration[], options?: MigrationOptions): Promise<MigrationResult[]>;
}
```

## Behavioral contract

| Call | `createBackup` | Expected `BackupManager.createBackup` count |
|------|----------------|-----------------------------------------------|
| `runMigrations([m1..mN])`, N≥1 | `true` / default | **1** (before first `up`) |
| `runMigrations([])` | `true` | **0** |
| `runMigrations([...])` | `false` | **0** |
| `runMigration(m)` | `true` / default | **1** |
| `runMigration(m)` | `false` | **0** |
| Nested: `runMigrations` then internal `runMigration` | run=`true` | still **1** total (per-version suppressed) |

## Failure

If run-scoped create throws/rejects with `createBackup: true`, no migration in
the batch may run `up`.

## Non-goals

- No new MCP tools.
- No change to `BackupManager` public method signatures required.
- `restoreBackup` / `findLatestBackup` remain available but unused by runner auto-path.
