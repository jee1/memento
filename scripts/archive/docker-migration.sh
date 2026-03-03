#!/bin/bash

echo "🐳 도커 환경에서 임베딩 데이터 마이그레이션 시작..."

# 1. 백업 생성
echo "💾 백업 생성 중..."
cp /app/data/memory.db /app/data/memory-backup-$(date +%s).db

# 2. sqlite-vec 없이 새로운 데이터베이스 생성
echo "📝 새로운 데이터베이스 생성 중..."
sqlite3 /app/data/memory-new.db << 'EOF'
-- 메인 기억 테이블
CREATE TABLE memory_item (
  id TEXT PRIMARY KEY,
  type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
  content TEXT NOT NULL,
  importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
  privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP,
  pinned BOOLEAN DEFAULT FALSE,
  tags TEXT,
  source TEXT,
  view_count INTEGER DEFAULT 0,
  cite_count INTEGER DEFAULT 0,
  edit_count INTEGER DEFAULT 0
);

-- 임베딩 저장 테이블 (새로운 컬럼 포함)
CREATE TABLE memory_embedding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  embedding_provider TEXT,
  dimensions INTEGER,
  created_by TEXT DEFAULT 'migration',
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id)
);

-- 인덱스 생성
CREATE INDEX idx_memory_embedding_provider ON memory_embedding(embedding_provider);
CREATE INDEX idx_memory_embedding_dimensions ON memory_embedding(dimensions);
CREATE INDEX idx_memory_embedding_created_by ON memory_embedding(created_by);
EOF

# 3. 데이터 복사
echo "📊 데이터 복사 중..."
sqlite3 /app/data/memory-new.db << 'EOF'
ATTACH DATABASE '/app/data/memory.db' AS source;

-- memory_item 데이터 복사
INSERT INTO memory_item 
SELECT * FROM source.memory_item;

-- memory_embedding 데이터 복사 및 메타데이터 추가
INSERT INTO memory_embedding (memory_id, embedding, dim, model, created_at, embedding_provider, dimensions, created_by)
SELECT 
  memory_id,
  embedding,
  dim,
  model,
  created_at,
  CASE 
    WHEN model = 'lightweight-hybrid' THEN 'tfidf'
    WHEN model IS NULL OR model = '' THEN 'tfidf'
    ELSE 'unknown'
  END as embedding_provider,
  dim as dimensions,
  'legacy' as created_by
FROM source.memory_embedding;

DETACH DATABASE source;
EOF

# 4. 검증
echo "🔍 마이그레이션 검증 중..."
sqlite3 /app/data/memory-new.db << 'EOF'
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as with_provider,
  COUNT(CASE WHEN dimensions IS NOT NULL THEN 1 END) as with_dimensions,
  COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END) as with_created_by
FROM memory_embedding;

SELECT 
  embedding_provider,
  dimensions,
  COUNT(*) as count
FROM memory_embedding 
GROUP BY embedding_provider, dimensions
ORDER BY count DESC;
EOF

# 5. 원본 데이터베이스 교체
echo "🔄 데이터베이스 교체 중..."
mv /app/data/memory.db /app/data/memory-old.db
mv /app/data/memory-new.db /app/data/memory.db

echo "✅ 마이그레이션 완료!"
echo "💾 백업 파일: /app/data/memory-backup-*.db"
echo "🔄 롤백이 필요한 경우: mv /app/data/memory-old.db /app/data/memory.db"
