# Database migration status check guide

How to verify that the database in use has been migrated.

## Quick check (CLI script)

### Method 1: Use npm script (default path)

```bash
npm run db:check-migration
```

This uses the `DB_PATH` environment variable or the default (`./data/memory.db`).

### Method 2: Specify database path

To check a database at another path (e.g. with npx or custom path):

```bash
npm run db:check-migration /path/to/memory.db
```

### Method 3: Environment variable

```bash
DB_PATH=/path/to/memory.db npm run db:check-migration
```

### Method 4: Run directly

```bash
# Recommended: use the root script
npm run db:check-migration [database-path]

# Or run with tsx from the repo root (`packages/memento-server/src/scripts`)
npx tsx packages/memento-server/src/scripts/check-migration-status.ts [database-path]
```

## What is checked

- Presence and version of the schema version table
- List of applied migrations
- Pending migrations, if any

For full details and troubleshooting, see the [Korean version](../ko/check-migration-status.md).
