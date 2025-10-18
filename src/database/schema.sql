-- Memento MCP Server SQLite 스키마
-- M1 단계: 개인용 SQLite 임베디드 데이터베이스

-- 메인 기억 테이블
CREATE TABLE IF NOT EXISTS memory_item (
  id TEXT PRIMARY KEY,
  type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
  content TEXT NOT NULL,
  importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
  privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP,
  pinned BOOLEAN DEFAULT FALSE,
  tags TEXT, -- JSON 배열로 저장
  source TEXT,
  view_count INTEGER DEFAULT 0,
  cite_count INTEGER DEFAULT 0,
  edit_count INTEGER DEFAULT 0
);

-- 태그 테이블
CREATE TABLE IF NOT EXISTS memory_tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 메모리-태그 관계 테이블 (N:N)
CREATE TABLE IF NOT EXISTS memory_item_tag (
  memory_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES memory_tag(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, tag_id)
);

-- 기억 간 관계 테이블
CREATE TABLE IF NOT EXISTS memory_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts')) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(source_id, target_id, relation_type)
);

-- 피드백 이벤트 테이블
CREATE TABLE IF NOT EXISTS feedback_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  event TEXT CHECK (event IN ('used', 'edited', 'neglected', 'helpful', 'not_helpful')) NOT NULL,
  score REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
);

-- 작업기억 버퍼 테이블 (세션별)
CREATE TABLE IF NOT EXISTS wm_buffer (
  session_id TEXT PRIMARY KEY,
  items TEXT NOT NULL, -- JSON 배열로 저장
  token_budget INTEGER DEFAULT 4000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_memory_item_type ON memory_item(type);
CREATE INDEX IF NOT EXISTS idx_memory_item_created_at ON memory_item(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed);
CREATE INDEX IF NOT EXISTS idx_memory_item_pinned ON memory_item(pinned);
CREATE INDEX IF NOT EXISTS idx_memory_item_privacy_scope ON memory_item(privacy_scope);
CREATE INDEX IF NOT EXISTS idx_memory_item_importance ON memory_item(importance);
CREATE INDEX IF NOT EXISTS idx_memory_item_user_id ON memory_item(id); -- user_id 대신 id 사용
CREATE INDEX IF NOT EXISTS idx_memory_item_project_id ON memory_item(id); -- project_id 대신 id 사용

CREATE INDEX IF NOT EXISTS idx_memory_tag_memory_id ON memory_item_tag(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_tag_tag_id ON memory_item_tag(tag_id);

CREATE INDEX IF NOT EXISTS idx_memory_link_source ON memory_link(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_link_target ON memory_link(target_id);

CREATE INDEX IF NOT EXISTS idx_feedback_memory_id ON feedback_event(memory_id);
CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback_event(event);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback_event(created_at);

CREATE INDEX IF NOT EXISTS idx_wm_buffer_expires_at ON wm_buffer(expires_at);

-- FTS5 가상 테이블 (전문 검색)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
  content,
  tags,
  source,
  content='memory_item',
  content_rowid='rowid'
);

-- FTS5 트리거 (자동 동기화)
CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
  INSERT INTO memory_item_fts(rowid, content, tags, source)
  VALUES (new.rowid, new.content, new.tags, new.source);
END;

CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
  INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source)
  VALUES('delete', old.rowid, old.content, old.tags, old.source);
END;

CREATE TRIGGER IF NOT EXISTS memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
  INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source)
  VALUES('delete', old.rowid, old.content, old.tags, old.source);
  INSERT INTO memory_item_fts(rowid, content, tags, source)
  VALUES (new.rowid, new.content, new.tags, new.source);
END;

-- 임베딩 저장 테이블 (다중 제공자/차원 지원)
CREATE TABLE IF NOT EXISTS memory_embedding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
  projection_type TEXT NOT NULL DEFAULT 'native',
  embedding TEXT NOT NULL, -- JSON 배열로 저장
  dim INTEGER NOT NULL, -- 원본 벡터 차원
  dimensions INTEGER DEFAULT 0, -- 저장된 벡터 차원 (패딩/축소 적용 후)
  model TEXT, -- 사용된 모델명
  precision INTEGER DEFAULT 32, -- 벡터 정밀도 (float32 등)
  normalized BOOLEAN DEFAULT FALSE, -- 정규화 여부
  version INTEGER DEFAULT 1, -- 임베딩 버전
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id, embedding_provider, projection_type)
);

-- 임베딩 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_provider ON memory_embedding(memory_id, embedding_provider);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider_projection ON memory_embedding(embedding_provider, projection_type);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_version ON memory_embedding(version);

-- 임베딩 모델 레지스트리 (제공자별 차원 및 메타데이터)
CREATE TABLE IF NOT EXISTS embedding_model_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  projection_type TEXT NOT NULL DEFAULT 'native',
  dimensions INTEGER NOT NULL,
  vec_table TEXT, -- sqlite-vec 테이블명
  priority INTEGER DEFAULT 100,
  status TEXT CHECK (status IN ('active','inactive','deprecated')) DEFAULT 'active',
  last_checked TIMESTAMP,
  metadata TEXT,
  UNIQUE(provider, projection_type),
  UNIQUE(provider, model),
  UNIQUE(vec_table)
);

-- VEC 가상 테이블 (벡터 검색) - sqlite-vec 확장 필요
-- 주의: sqlite-vec 확장이 설치되어 있어야 함
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec USING vec0(embedding float[384]);

-- 제공자별 VEC 테이블들
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_tfidf USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_minilm USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_openai USING vec0(embedding float[1536]);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_gemini USING vec0(embedding float[768]);

-- VEC 테이블 트리거 (임베딩이 생성될 때 자동으로 VEC 테이블에 추가)
-- 제공자별 테이블에 저장하도록 수정
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

-- 초기 데이터 삽입 (선택사항)
-- INSERT OR IGNORE INTO memory_item (id, type, content, importance, privacy_scope, pinned)
-- VALUES ('welcome', 'semantic', 'Memento MCP Server에 오신 것을 환영합니다!', 1.0, 'private', TRUE);
