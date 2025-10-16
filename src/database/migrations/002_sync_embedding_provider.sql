-- Migration: synchronize memory_embedding schema with embedding provider metadata
-- Up

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Drop existing vec triggers to avoid referencing dropped table
DROP TRIGGER IF EXISTS memory_embedding_vec_insert;
DROP TRIGGER IF EXISTS memory_embedding_vec_update;
DROP TRIGGER IF EXISTS memory_embedding_vec_delete;

-- Recreate table with provider metadata columns
CREATE TABLE IF NOT EXISTS memory_embedding__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  embedding_provider TEXT DEFAULT 'tfidf',
  dimensions INTEGER,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id)
);

-- Migrate existing data and infer provider/dimensions when missing
INSERT INTO memory_embedding__new (
  id,
  memory_id,
  embedding,
  dim,
  model,
  embedding_provider,
  dimensions,
  created_by,
  created_at
)
SELECT
  id,
  memory_id,
  embedding,
  dim,
  model,
  COALESCE(
    NULLIF(embedding_provider, ''),
    CASE
      WHEN model IN ('lightweight-hybrid', 'tfidf') THEN 'tfidf'
      WHEN model LIKE '%minilm%' THEN 'minilm'
      WHEN model LIKE '%openai%' THEN 'openai'
      WHEN model LIKE '%gemini%' THEN 'gemini'
      ELSE 'tfidf'
    END
  ),
  COALESCE(dimensions, dim),
  COALESCE(created_by, 'legacy'),
  created_at
FROM memory_embedding;

DROP TABLE memory_embedding;
ALTER TABLE memory_embedding__new RENAME TO memory_embedding;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dim ON memory_embedding(dim);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by);

-- Recreate vec triggers using provider metadata
CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
  INSERT INTO memory_item_vec(rowid, embedding)
  VALUES (NEW.id, json_extract(NEW.embedding, '$'));

  INSERT INTO memory_item_vec_tfidf(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'tfidf';

  INSERT INTO memory_item_vec_minilm(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'minilm';

  INSERT INTO memory_item_vec_openai(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'openai';

  INSERT INTO memory_item_vec_gemini(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'gemini';
END;

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
  UPDATE memory_item_vec
  SET embedding = json_extract(NEW.embedding, '$')
  WHERE rowid = NEW.id;

  UPDATE memory_item_vec_tfidf
  SET embedding = json_extract(NEW.embedding, '$')
  WHERE rowid = NEW.id AND NEW.embedding_provider = 'tfidf';

  UPDATE memory_item_vec_minilm
  SET embedding = json_extract(NEW.embedding, '$')
  WHERE rowid = NEW.id AND NEW.embedding_provider = 'minilm';

  UPDATE memory_item_vec_openai
  SET embedding = json_extract(NEW.embedding, '$')
  WHERE rowid = NEW.id AND NEW.embedding_provider = 'openai';

  UPDATE memory_item_vec_gemini
  SET embedding = json_extract(NEW.embedding, '$')
  WHERE rowid = NEW.id AND NEW.embedding_provider = 'gemini';
END;

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_delete AFTER DELETE ON memory_embedding BEGIN
  DELETE FROM memory_item_vec WHERE rowid = OLD.id;
  DELETE FROM memory_item_vec_tfidf WHERE rowid = OLD.id;
  DELETE FROM memory_item_vec_minilm WHERE rowid = OLD.id;
  DELETE FROM memory_item_vec_openai WHERE rowid = OLD.id;
  DELETE FROM memory_item_vec_gemini WHERE rowid = OLD.id;
END;

COMMIT;
PRAGMA foreign_keys = ON;

-- Down

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

DROP TRIGGER IF EXISTS memory_embedding_vec_insert;
DROP TRIGGER IF EXISTS memory_embedding_vec_update;
DROP TRIGGER IF EXISTS memory_embedding_vec_delete;

CREATE TABLE IF NOT EXISTS memory_embedding__old (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id)
);

INSERT INTO memory_embedding__old (
  id,
  memory_id,
  embedding,
  dim,
  model,
  created_at
)
SELECT
  id,
  memory_id,
  embedding,
  dim,
  model,
  created_at
FROM memory_embedding;

DROP TABLE memory_embedding;
ALTER TABLE memory_embedding__old RENAME TO memory_embedding;

CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dim ON memory_embedding(dim);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
  INSERT INTO memory_item_vec(rowid, embedding)
  VALUES (NEW.memory_id, json_extract(NEW.embedding, '$'));
END;

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
  UPDATE memory_item_vec
  SET embedding = json_extract(NEW.embedding, '$')
  WHERE rowid = NEW.memory_id;
END;

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_delete AFTER DELETE ON memory_embedding BEGIN
  DELETE FROM memory_item_vec WHERE rowid = OLD.memory_id;
END;

COMMIT;
PRAGMA foreign_keys = ON;
