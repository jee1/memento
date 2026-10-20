import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { hashMemoryContent } from '../../../../../shared/utils/memory-content-hash.js';
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

  it('backfills NULL content hashes from memory content and is idempotent', async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL);
      CREATE TABLE memory_embedding (
        id INTEGER PRIMARY KEY,
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL,
        projection_type TEXT NOT NULL DEFAULT 'native'
      );
      INSERT INTO memory_item VALUES ('a', 'alpha'), ('b', 'beta');
      INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type) VALUES ('a', 'minilm', 'native');
      INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type) VALUES ('a', 'minilm', 'window:0');
      INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type) VALUES ('b', 'minilm', 'native');
      INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type) VALUES ('orphan', 'minilm', 'native');
    `);
    const migration = new MemoryEmbeddingContentHashMigration();
    const hashes = () => db!.prepare('SELECT memory_id, projection_type, content_hash FROM memory_embedding ORDER BY id').all();

    await migration.up(db);
    const afterFirst = hashes();
    await migration.up(db);

    expect(afterFirst).toEqual([
      { memory_id: 'a', projection_type: 'native', content_hash: hashMemoryContent('alpha') },
      { memory_id: 'a', projection_type: 'window:0', content_hash: hashMemoryContent('alpha') },
      { memory_id: 'b', projection_type: 'native', content_hash: hashMemoryContent('beta') },
      { memory_id: 'orphan', projection_type: 'native', content_hash: null },
    ]);
    expect(hashes()).toEqual(afterFirst);
  });
});
