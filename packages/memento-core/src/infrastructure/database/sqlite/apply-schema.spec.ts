import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applySchema, resolveSchemaPath } from './apply-schema.js';
import { configureSqliteSession } from './init-sqlite-session.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(currentDirectory, '../../../..');

describe('applySchema', () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it('requires the SQLite session to be configured before applying schema.sql', async () => {
    db = new Database(':memory:');

    expect(() => applySchema(db!)).toThrow(/configureSqliteSession/);
  });

  it('applies the canonical schema after the SQLite session precondition', async () => {
    db = new Database(':memory:');
    await configureSqliteSession(db);

    applySchema(db);

    const objects = db
      .prepare("SELECT name FROM sqlite_master WHERE name IN ('memory_item', 'anchor', 'memory_item_fts_insert') ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(objects.map(({ name }) => name)).toEqual([
      'anchor',
      'memory_item',
      'memory_item_fts_insert'
    ]);
  });

  it('resolves source and built layouts to byte-identical schema assets', () => {
    const sourcePath = resolveSchemaPath(currentDirectory);
    const distPath = resolveSchemaPath(resolve(packageRoot, 'dist/infrastructure/database/sqlite'));

    expect(sourcePath).toBe(resolve(currentDirectory, 'schema.sql'));
    expect(distPath).toBe(resolve(packageRoot, 'dist/database/schema.sql'));
    expect(readFileSync(distPath, 'utf8')).toBe(readFileSync(sourcePath, 'utf8'));
  });
});
