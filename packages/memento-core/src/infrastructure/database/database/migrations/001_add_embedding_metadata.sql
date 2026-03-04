-- 임베딩 메타데이터 추가 마이그레이션
-- 기존 memory_embedding 테이블에 제공자 정보 추가

-- 1. 새로운 컬럼 추가
ALTER TABLE memory_embedding ADD COLUMN embedding_provider TEXT;
ALTER TABLE memory_embedding ADD COLUMN dimensions INTEGER;
ALTER TABLE memory_embedding ADD COLUMN created_by TEXT DEFAULT 'migration';

-- 2. 기존 데이터 업데이트
-- 512차원 데이터는 TF-IDF로 추정 (기본값)
UPDATE memory_embedding 
SET 
  embedding_provider = CASE 
    WHEN model = 'lightweight-hybrid' THEN 'tfidf'
    WHEN model IS NULL OR model = '' THEN 'tfidf'
    ELSE 'unknown'
  END,
  dimensions = dim,
  created_by = 'legacy'
WHERE embedding_provider IS NULL;

-- 3. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by);

-- 4. 제약 조건 추가
-- embedding_provider는 유효한 값만 허용
-- 이 부분은 SQLite에서 CHECK 제약조건이 제한적이므로 애플리케이션 레벨에서 검증
