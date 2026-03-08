# Migration system guide

## Overview

The Memento project uses a formal migration system to manage database schema changes safely. This document describes the migration interfaces and how to use them.

After changing the schema, update the **design document** ([database-design.md](../../architecture/en/database-design.md)) in the relevant sections (tables, indexes, migration history).

## Migration system structure

### Core components

- **MigrationRunner**: Migration execution engine (`packages/memento-core/src/infrastructure/database/database/migration/migration-runner.ts`)
- **MigrationDetector**: Auto-detection of migrations
- **BackupManager**: Backup and restore
- **SchemaVersionManager**: Schema version tracking
- **MigrationLogger**: Migration logging

### Migration directory

Migrations live under `packages/memento-core/src/infrastructure/database/database/migration/migrations/`.

Naming: `{version}-{name}.ts`

## Running migrations

```bash
npm run db:migrate
```

For full usage, CLI options, and troubleshooting, see the [Korean version](../ko/migration-system-guide.md).
