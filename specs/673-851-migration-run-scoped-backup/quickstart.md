# Quickstart: Verify run-scoped migration backup

1. Use a **temp** SQLite file DB (never live `DB_PATH`).
2. Build N≥5 no-op / minimal migrations.
3. Spy `BackupManager.createBackup` (or count files under temp `backups/`).
4. `await runner.runMigrations(migrations, { createBackup: true })`.
5. Expect **exactly 1** create (and ≤1 new backup file for that run).
6. Focused test:

```bash
npm test -- packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.spec.ts
```
