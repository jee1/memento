/**
 * #753 — memory_embedding metadata 기본값 보정 (bootstrap/migrate 1회용).
 * Hot path(create/search/stats)에서는 호출하지 않는다.
 * SQL은 기존 MemoryEmbeddingService.ensureMetadataDefaults와 동일 의미.
 */

import type Database from 'better-sqlite3';

export const MEMORY_EMBEDDING_METADATA_DEFAULTS_SQL = `
  UPDATE memory_embedding
  SET embedding_provider = COALESCE(
    NULLIF(embedding_provider, ''),
    CASE
      WHEN model IN ('lightweight-hybrid', 'tfidf') THEN 'tfidf'
      WHEN model LIKE '%minilm%' THEN 'minilm'
      WHEN model LIKE '%openai%' THEN 'openai'
      WHEN model LIKE '%gemini%' THEN 'gemini'
      WHEN model = 'mock' THEN 'mock'
      ELSE ?
    END
  ),
  projection_type = COALESCE(NULLIF(projection_type, ''), 'native'),
  precision = COALESCE(precision, 32),
  normalized = COALESCE(normalized, 0),
  version = COALESCE(version, 1),
  dim = CASE
    WHEN dim IS NULL OR dim = 0 THEN
      CASE typeof(embedding)
        WHEN 'blob' THEN length(embedding) / 4
        WHEN 'text' THEN json_array_length(embedding)
        ELSE 0
      END
    ELSE dim
  END,
  dimensions = CASE
    WHEN dimensions IS NULL OR dimensions = 0 THEN
      CASE typeof(embedding)
        WHEN 'blob' THEN length(embedding) / 4
        WHEN 'text' THEN json_array_length(embedding)
        ELSE 0
      END
    ELSE dimensions
  END,
  created_by = COALESCE(created_by, 'legacy')
  WHERE embedding_provider IS NULL
     OR embedding_provider = ''
     OR dimensions IS NULL
     OR dimensions = 0
     OR projection_type IS NULL
     OR projection_type = ''
     OR precision IS NULL
     OR precision = 0
     OR normalized IS NULL
     OR version IS NULL
     OR version = 0
     OR created_by IS NULL
`;

/**
 * 레거시/부분 메타데이터 행을 테이블 전역으로 한 번 보정한다.
 * memory_embedding 테이블이 없으면 no-op.
 */
export function ensureMemoryEmbeddingMetadataDefaults(
  db: Database.Database,
  defaultProvider: string = 'tfidf'
): void {
  const hasTable = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_embedding' LIMIT 1`
    )
    .get();
  if (!hasTable) {
    return;
  }

  // Mid-era schemas can have embedding/projection_type without precision.
  // migrate rebuilds only when those two are missing; UPDATE must not throw.
  const columnNames = new Set(
    (db.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string }>).map(
      column => column.name
    )
  );
  const requiredColumns = [
    'embedding_provider',
    'projection_type',
    'precision',
    'normalized',
    'version',
    'dim',
    'dimensions',
    'created_by',
    'embedding',
    'model'
  ];
  if (requiredColumns.some(column => !columnNames.has(column))) {
    return;
  }

  db.prepare(MEMORY_EMBEDDING_METADATA_DEFAULTS_SQL).run(defaultProvider);
}
