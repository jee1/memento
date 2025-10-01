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

-- 태그 테이블 (N:N 관계)
CREATE TABLE IF NOT EXISTS memory_tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id, tag)
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
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_item(type);
CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory_item(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_last_accessed ON memory_item(last_accessed);
CREATE INDEX IF NOT EXISTS idx_memory_pinned ON memory_item(pinned);
CREATE INDEX IF NOT EXISTS idx_memory_privacy_scope ON memory_item(privacy_scope);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_item(importance);

CREATE INDEX IF NOT EXISTS idx_memory_tag_memory_id ON memory_tag(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_tag_tag ON memory_tag(tag);

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

-- 임베딩 저장 테이블
CREATE TABLE IF NOT EXISTS memory_embedding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  embedding TEXT NOT NULL, -- JSON 배열로 저장
  dim INTEGER NOT NULL, -- 벡터 차원
  model TEXT, -- 사용된 모델명
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id)
);

-- 임베딩 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dim ON memory_embedding(dim);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);

-- VSS 가상 테이블 (벡터 검색) - sqlite-vss 확장 필요
-- 주의: sqlite-vss 확장이 설치되어 있어야 함
-- CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vss USING vss0(embedding(1536));

-- 초기 데이터 삽입 (선택사항)
-- INSERT OR IGNORE INTO memory_item (id, type, content, importance, privacy_scope, pinned)
-- VALUES ('welcome', 'semantic', 'Memento MCP Server에 오신 것을 환영합니다!', 1.0, 'private', TRUE);
