import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSqliteSessionConfigured } from './init-sqlite-session.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export function resolveSchemaPath(moduleDirectory = currentDirectory): string {
  const bundledPath = join(moduleDirectory, '..', '..', '..', 'database', 'schema.sql');
  if (existsSync(bundledPath)) return bundledPath;

  const sourcePath = join(moduleDirectory, 'schema.sql');
  if (existsSync(sourcePath)) return sourcePath;

  throw new Error(`Unable to locate schema.sql from ${moduleDirectory}`);
}

export function applySchema(db: Database.Database): void {
  assertSqliteSessionConfigured(db);
  db.exec(readFileSync(resolveSchemaPath(), 'utf8'));
}
