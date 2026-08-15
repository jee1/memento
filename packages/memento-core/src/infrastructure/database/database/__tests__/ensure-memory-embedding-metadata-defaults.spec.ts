/**
 * #753 — embedding metadata repair once at bootstrap/migrate (legacy fixture)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureMemoryEmbeddingMetadataDefaults } from '../ensure-memory-embedding-metadata-defaults.js';

const LEGACY_MEMORY_ID = 'mem-legacy-meta-1';

function createModernSchemaWithNullMetadata(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT,
      projection_type TEXT,
      embedding TEXT NOT NULL,
      dim INTEGER,
      dimensions INTEGER,
      model TEXT,
      precision INTEGER,
      normalized BOOLEAN,
      version INTEGER,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO memory_item (id, type, content) VALUES (?, 'episodic', 'legacy null metadata')`
  ).run(LEGACY_MEMORY_ID);
  db.prepare(
    `INSERT INTO memory_embedding (
      memory_id, embedding_provider, projection_type, embedding, dim, dimensions,
      model, precision, normalized, version, created_by
    ) VALUES (?, NULL, NULL, ?, 0, 0, 'lightweight-hybrid', NULL, NULL, NULL, NULL)`
  ).run(LEGACY_MEMORY_ID, JSON.stringify(new Array(8).fill(0.1)));
}

describe('ensureMemoryEmbeddingMetadataDefaults (#753)', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {
        // already closed
      }
      db = undefined;
    }
  });

  it('Given: legacy row with NULL metadata, When: ensure once, Then: provider/dims/created_by=legacy filled', () => {
    db = new Database(':memory:');
    createModernSchemaWithNullMetadata(db);

    ensureMemoryEmbeddingMetadataDefaults(db, 'tfidf');

    const row = db
      .prepare(
        `SELECT embedding_provider, projection_type, precision, normalized, version,
                created_by, dimensions, dim
         FROM memory_embedding WHERE memory_id = ?`
      )
      .get(LEGACY_MEMORY_ID) as {
      embedding_provider: string;
      projection_type: string;
      precision: number;
      normalized: number;
      version: number;
      created_by: string;
      dimensions: number;
      dim: number;
    };

    expect(row.embedding_provider).toBe('tfidf');
    expect(row.projection_type).toBe('native');
    expect(row.precision).toBe(32);
    expect(row.normalized).toBe(0);
    expect(row.version).toBe(1);
    expect(row.created_by).toBe('legacy');
    expect(row.dimensions).toBe(8);
    expect(row.dim).toBe(8);
  });

  it('Given: memory_embedding without precision column, When: ensure, Then: no-op without throw', () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
        projection_type TEXT NOT NULL DEFAULT 'native',
        embedding TEXT NOT NULL,
        dim INTEGER NOT NULL,
        dimensions INTEGER DEFAULT 0,
        model TEXT,
        version INTEGER DEFAULT 1
      )
    `);

    expect(() => ensureMemoryEmbeddingMetadataDefaults(db, 'tfidf')).not.toThrow();
  });

  it('Given: legacy null metadata DB, When: migrateDatabase runs, Then: repair fills created_by=legacy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-meta-defaults-'));
    const dbPath = join(dir, 'memory.db');
    const seed = new Database(dbPath);
    createModernSchemaWithNullMetadata(seed);
    seed.close();

    const previousDbPath = process.env.DB_PATH;
    try {
      vi.resetModules();
      process.env.DB_PATH = dbPath;
      const migrateModule = await import('../migrate.js');
      migrateModule.migrateDatabase();

      const verify = new Database(dbPath, { readonly: true });
      try {
        const row = verify
          .prepare(
            `SELECT embedding_provider, projection_type, created_by, dimensions, dim
             FROM memory_embedding WHERE memory_id = ?`
          )
          .get(LEGACY_MEMORY_ID) as {
          embedding_provider: string;
          projection_type: string;
          created_by: string;
          dimensions: number;
          dim: number;
        };
        expect(row.embedding_provider).toBe('tfidf');
        expect(row.projection_type).toBe('native');
        expect(row.created_by).toBe('legacy');
        expect(row.dimensions).toBe(8);
        expect(row.dim).toBe(8);
      } finally {
        verify.close();
      }
    } finally {
      if (previousDbPath === undefined) {
        delete process.env.DB_PATH;
      } else {
        process.env.DB_PATH = previousDbPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
