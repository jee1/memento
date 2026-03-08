-- Migration: embedding compatibility schema upgrade
-- Up

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

DROP TRIGGER IF EXISTS memory_embedding_vec_insert;
DROP TRIGGER IF EXISTS memory_embedding_vec_update;
DROP TRIGGER IF EXISTS memory_embedding_vec_delete;

CREATE TABLE IF NOT EXISTS memory_embedding__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
  projection_type TEXT NOT NULL DEFAULT 'native',
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  dimensions INTEGER DEFAULT 0,
  model TEXT,
  precision INTEGER DEFAULT 32,
  normalized BOOLEAN DEFAULT FALSE,
  version INTEGER DEFAULT 1,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id, embedding_provider, projection_type)
);

INSERT INTO memory_embedding__new (
  id,
  memory_id,
  embedding_provider,
  projection_type,
  embedding,
  dim,
  dimensions,
  model,
  precision,
  normalized,
  version,
  created_by,
  created_at
)
SELECT
  id,
  memory_id,
  COALESCE(NULLIF(embedding_provider, ''), 'tfidf'),
  'native',
  embedding,
  dim,
  COALESCE(NULLIF(dimensions, 0), dim),
  model,
  32,
  0,
  1,
  COALESCE(NULLIF(created_by, ''), 'system'),
  created_at
FROM memory_embedding;

DROP TABLE memory_embedding;
ALTER TABLE memory_embedding__new RENAME TO memory_embedding;

CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_provider ON memory_embedding(memory_id, embedding_provider);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider_projection ON memory_embedding(embedding_provider, projection_type);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_version ON memory_embedding(version);

CREATE TABLE IF NOT EXISTS embedding_model_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  projection_type TEXT NOT NULL DEFAULT 'native',
  dimensions INTEGER NOT NULL,
  vec_table TEXT,
  priority INTEGER DEFAULT 100,
  status TEXT CHECK (status IN ('active','inactive','deprecated')) DEFAULT 'active',
  last_checked TIMESTAMP,
  metadata TEXT,
  UNIQUE(provider, projection_type),
  UNIQUE(provider, model),
  UNIQUE(vec_table)
);

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
  INSERT INTO memory_item_vec(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.dimensions = 384;

  INSERT INTO memory_item_vec_tfidf(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';

  INSERT INTO memory_item_vec_minilm(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';

  INSERT INTO memory_item_vec_openai(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';

  INSERT INTO memory_item_vec_gemini(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
END;

CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
  DELETE FROM memory_item_vec WHERE rowid = NEW.id;
  DELETE FROM memory_item_vec_tfidf WHERE rowid = NEW.id;
  DELETE FROM memory_item_vec_minilm WHERE rowid = NEW.id;
  DELETE FROM memory_item_vec_openai WHERE rowid = NEW.id;
  DELETE FROM memory_item_vec_gemini WHERE rowid = NEW.id;

  INSERT INTO memory_item_vec(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.dimensions = 384;

  INSERT INTO memory_item_vec_tfidf(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';

  INSERT INTO memory_item_vec_minilm(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';

  INSERT INTO memory_item_vec_openai(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';

  INSERT INTO memory_item_vec_gemini(rowid, embedding)
  SELECT NEW.id, json_extract(NEW.embedding, '$')
  WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
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
DROP TABLE IF EXISTS embedding_model_registry;

CREATE TABLE IF NOT EXISTS memory_embedding__old (
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

INSERT INTO memory_embedding__old (
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
  embedding_provider,
  dimensions,
  created_by,
  created_at
FROM memory_embedding
WHERE id IN (
  SELECT MIN(id) FROM memory_embedding GROUP BY memory_id
);

DROP TABLE memory_embedding;
ALTER TABLE memory_embedding__old RENAME TO memory_embedding;

CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dim ON memory_embedding(dim);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);

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
