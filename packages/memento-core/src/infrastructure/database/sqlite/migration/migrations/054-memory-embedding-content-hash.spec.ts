import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryEmbeddingContentHashMigration } from './054-memory-embedding-content-hash.js';

describe('MemoryEmbeddingContentHashMigration (#1391)', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('adds the content hash and removes old provider rows when source content changes', async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL);
      CREATE TABLE memory_embedding (
        id INTEGER PRIMARY KEY,
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL,
        projection_type TEXT NOT NULL DEFAULT 'native'
      );
      INSERT INTO memory_item VALUES ('memory', 'old');
      INSERT INTO memory_embedding (memory_id, embedding_provider) VALUES ('memory', 'minilm');
      INSERT INTO memory_embedding (memory_id, embedding_provider) VALUES ('memory', 'tfidf');
    `);
    const migration = new MemoryEmbeddingContentHashMigration();

    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);
    db.prepare("UPDATE memory_item SET content = 'new' WHERE id = 'memory'").run();

    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 0 });
  });
});
