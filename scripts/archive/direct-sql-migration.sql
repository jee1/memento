-- 임베딩 데이터 마이그레이션 SQL
-- 기존 데이터에 메타데이터 추가

-- 1. 기존 데이터 업데이트
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

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by);

-- 3. 검증 쿼리
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as with_provider,
  COUNT(CASE WHEN dimensions IS NOT NULL THEN 1 END) as with_dimensions,
  COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END) as with_created_by
FROM memory_embedding;

-- 4. 최종 데이터 분포 확인
SELECT 
  embedding_provider,
  dimensions,
  COUNT(*) as count
FROM memory_embedding 
GROUP BY embedding_provider, dimensions
ORDER BY count DESC;
