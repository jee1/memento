/**
 * #755 — memory_embedding rebuild atomicity (create/copy/drop/rename)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LEGACY_ROW = {
  memory_id: 'mem-legacy-1',
  dim: 384,
  model: 'legacy-model',
} as const;

function createLegacyDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      project_id TEXT,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      model TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO memory_item (id, type, content) VALUES (?, 'episodic', 'legacy content')`
  ).run(LEGACY_ROW.memory_id);
  db.prepare(
    `INSERT INTO memory_embedding (memory_id, dim, model) VALUES (?, ?, ?)`
  ).run(LEGACY_ROW.memory_id, LEGACY_ROW.dim, LEGACY_ROW.model);
  db.close();
}

async function runMigrateWithDbPath(dbPath: string): Promise<void> {
  vi.resetModules();
  process.env.DB_PATH = dbPath;
  const migrateModule = await import('../migrate.js');
  migrateModule.migrateDatabase();
}

describe('memory_embedding rebuild atomicity (#755)', () => {
  let dir: string | undefined;
  let previousDbPath: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousDbPath;
    }
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('Given: rebuild copies then aborts before rename, When: migrate fails mid-rebuild, Then: live memory_embedding + rows survive', async () => {
    previousDbPath = process.env.DB_PATH;
    dir = mkdtempSync(join(tmpdir(), 'memento-migrate-atomic-'));
    const dbPath = join(dir, 'memory.db');
    createLegacyDb(dbPath);

    const originalExec = Database.prototype.exec;
    vi.spyOn(Database.prototype, 'exec').mockImplementation(function (
      this: Database.Database,
      sql: string
    ) {
      if (
        typeof sql === 'string' &&
        /ALTER\s+TABLE\s+memory_embedding__new\s+RENAME\s+TO\s+memory_embedding/i.test(sql)
      ) {
        throw new Error('injected: abort after copy / before rename');
      }
      return originalExec.call(this, sql);
    });

    await expect(runMigrateWithDbPath(dbPath)).rejects.toThrow(
      /injected: abort after copy \/ before rename/
    );

    const verify = new Database(dbPath, { readonly: true });
    try {
      const table = verify
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'`
        )
        .get() as { name: string } | undefined;
      expect(table?.name).toBe('memory_embedding');

      const orphan = verify
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding__new'`
        )
        .get();
      expect(orphan).toBeUndefined();

      const rows = verify
        .prepare(`SELECT memory_id, dim, model FROM memory_embedding`)
        .all() as Array<{ memory_id: string; dim: number; model: string }>;
      expect(rows).toEqual([
        {
          memory_id: LEGACY_ROW.memory_id,
          dim: LEGACY_ROW.dim,
          model: LEGACY_ROW.model,
        },
      ]);
    } finally {
      verify.close();
    }
  });

  it('Given: legacy memory_embedding without embedding/projection_type, When: migrate succeeds, Then: rebuilt schema keeps rows', async () => {
    previousDbPath = process.env.DB_PATH;
    dir = mkdtempSync(join(tmpdir(), 'memento-migrate-success-'));
    const dbPath = join(dir, 'memory.db');
    createLegacyDb(dbPath);

    await expect(runMigrateWithDbPath(dbPath)).resolves.toBeUndefined();

    const verify = new Database(dbPath, { readonly: true });
    try {
      const columns = (
        verify.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining(['embedding', 'projection_type', 'embedding_provider'])
      );

      const rows = verify
        .prepare(
          `SELECT memory_id, dim, model, projection_type, embedding FROM memory_embedding`
        )
        .all() as Array<{
          memory_id: string;
          dim: number;
          model: string;
          projection_type: string;
          embedding: string;
        }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        memory_id: LEGACY_ROW.memory_id,
        dim: LEGACY_ROW.dim,
        model: LEGACY_ROW.model,
        projection_type: 'native',
        embedding: '[]',
      });
    } finally {
      verify.close();
    }
  });

  it('Given: rebuild already applied, When: migrate runs again, Then: idempotent and rows unchanged', async () => {
    previousDbPath = process.env.DB_PATH;
    dir = mkdtempSync(join(tmpdir(), 'memento-migrate-idempotent-'));
    const dbPath = join(dir, 'memory.db');
    createLegacyDb(dbPath);

    await runMigrateWithDbPath(dbPath);
    await expect(runMigrateWithDbPath(dbPath)).resolves.toBeUndefined();

    const verify = new Database(dbPath, { readonly: true });
    try {
      const count = (
        verify.prepare(`SELECT COUNT(*) AS n FROM memory_embedding`).get() as { n: number }
      ).n;
      expect(count).toBe(1);

      const row = verify
        .prepare(`SELECT memory_id, dim, model FROM memory_embedding WHERE memory_id = ?`)
        .get(LEGACY_ROW.memory_id) as { memory_id: string; dim: number; model: string };
      expect(row).toEqual({
        memory_id: LEGACY_ROW.memory_id,
        dim: LEGACY_ROW.dim,
        model: LEGACY_ROW.model,
      });
    } finally {
      verify.close();
    }
  });
});
