import type Database from 'better-sqlite3';
import { log } from './init-log.js';
import {
  VEC_TABLES,
  buildVecTableDdl,
  hasCosineDistanceMetric,
  repopulateVecTable,
  type VecTableConfig
} from './vec-schema.js';

export type { VecTableConfig };

/**
 * 레거시 스키마 호환성: 누락된 컬럼 추가
 *
 * 왜 이 함수가 필요한가?
 * - 레거시 데이터베이스는 최신 스키마와 다를 수 있음
 * - 마이그레이션 없이도 기존 데이터를 보존하면서 새 컬럼 추가 필요
 * - 하위 호환성 유지를 위해 안전하게 컬럼 추가
 */
function addMissingColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
  postUpdateSql?: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const hasColumn = columns.some(column => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    if (postUpdateSql) {
      db.exec(postUpdateSql);
    }
  }
}

function ensureLegacyMemoryEmbeddingColumns(db: Database.Database): void {
  const hasEmbeddingTable = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'`)
    .get();

  if (!hasEmbeddingTable) {
    return;
  }

  addMissingColumn(
    db,
    'memory_embedding',
    'embedding',
    "TEXT NOT NULL DEFAULT '[]'",
    `
          UPDATE memory_embedding
          SET embedding = COALESCE(NULLIF(embedding, ''), '[]')
          WHERE embedding IS NULL OR embedding = ''
        `
  );
  addMissingColumn(
    db,
    'memory_embedding',
    'embedding_provider',
    "TEXT NOT NULL DEFAULT 'tfidf'",
    `
          UPDATE memory_embedding
          SET embedding_provider = COALESCE(NULLIF(embedding_provider, ''), 'tfidf')
          WHERE embedding_provider IS NULL OR embedding_provider = ''
        `
  );
  addMissingColumn(
    db,
    'memory_embedding',
    'projection_type',
    "TEXT NOT NULL DEFAULT 'native'",
    `
          UPDATE memory_embedding
          SET projection_type = COALESCE(NULLIF(projection_type, ''), 'native')
          WHERE projection_type IS NULL OR projection_type = ''
        `
  );
  addMissingColumn(
    db,
    'memory_embedding',
    'dimensions',
    'INTEGER DEFAULT 0',
    `
          UPDATE memory_embedding
          SET dimensions = CASE
            WHEN dimensions IS NULL OR dimensions <= 0 THEN COALESCE(NULLIF(dim, 0), dimensions)
            ELSE dimensions
          END
        `
  );
  addMissingColumn(db, 'memory_embedding', 'model', 'TEXT');
  addMissingColumn(
    db,
    'memory_embedding',
    'precision',
    'INTEGER DEFAULT 32',
    `
          UPDATE memory_embedding
          SET precision = COALESCE(NULLIF(precision, 0), 32)
        `
  );
  addMissingColumn(
    db,
    'memory_embedding',
    'normalized',
    'BOOLEAN DEFAULT FALSE',
    `
          UPDATE memory_embedding
          SET normalized = COALESCE(normalized, 0)
        `
  );
  addMissingColumn(
    db,
    'memory_embedding',
    'version',
    'INTEGER DEFAULT 1',
    `
          UPDATE memory_embedding
          SET version = COALESCE(NULLIF(version, 0), 1)
        `
  );
  addMissingColumn(
    db,
    'memory_embedding',
    'created_by',
    "TEXT DEFAULT 'system'",
    `
          UPDATE memory_embedding
          SET created_by = COALESCE(NULLIF(created_by, ''), 'system')
        `
  );
  addMissingColumn(db, 'memory_embedding', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
}

function ensureLegacyEmbeddingModelRegistryProjectionType(db: Database.Database): void {
  const hasRegistryTable = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_model_registry'`)
    .get();

  if (!hasRegistryTable) {
    return;
  }

  const registryColumns = db
    .prepare('PRAGMA table_info(embedding_model_registry)')
    .all() as Array<{ name: string }>;
  const hasRegistryProjectionType = registryColumns.some(column => column.name === 'projection_type');

  if (!hasRegistryProjectionType) {
    db.exec(`
          ALTER TABLE embedding_model_registry
          ADD COLUMN projection_type TEXT NOT NULL DEFAULT 'native'
        `);
    db.exec(`
          UPDATE embedding_model_registry
          SET projection_type = 'native'
          WHERE projection_type IS NULL OR projection_type = ''
        `);
  }
}

/**
 * VEC 테이블의 차원과 distance metric(cosine, issue #713)을 검증하고,
 * 어긋난 테이블을 재생성한 뒤 재구축이 필요한 설정 목록을 반환한다.
 */
function reconcileMisalignedVecTables(db: Database.Database): VecTableConfig[] {
  const vecTablesToRepopulate: VecTableConfig[] = [];

  for (const config of VEC_TABLES) {
    const existing = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
      .get(config.name) as { sql?: string } | undefined;
    const hasExpectedDimension = existing?.sql?.includes(`float[${config.dimension}]`) ?? false;

    if (!hasExpectedDimension || !hasCosineDistanceMetric(existing?.sql)) {
      db.exec(`DROP TABLE IF EXISTS ${config.name}`);
      db.exec(buildVecTableDdl(config));
      vecTablesToRepopulate.push(config);
    }
  }

  return vecTablesToRepopulate;
}

/**
 * 레거시 스키마 호환성 보장
 *
 * @returns 재구축이 필요한 VEC 테이블 설정 목록
 */
export function ensureLegacySchema(db: Database.Database): VecTableConfig[] {
  const vecTablesToRepopulate: VecTableConfig[] = [];

  try {
    ensureLegacyMemoryEmbeddingColumns(db);
    ensureLegacyEmbeddingModelRegistryProjectionType(db);
    vecTablesToRepopulate.push(...reconcileMisalignedVecTables(db));

    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete');
  } catch (error) {
    log('[WARN] 레거시 스키마 호환성 조정 실패:', error);
  }

  return vecTablesToRepopulate;
}

export function populateVecTables(db: Database.Database, configs: VecTableConfig[]): void {
  if (!configs.length) {
    return;
  }

  const hasEmbeddingTable = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'`)
    .get();

  if (!hasEmbeddingTable) {
    return;
  }

  for (const config of configs) {
    try {
      // repopulateVecTable이 VEC_TABLES 화이트리스트로 테이블명을 검증한다.
      repopulateVecTable(db, config);
    } catch (error) {
      log(`[WARN] ${config.name} 재구축 중 오류 발생:`, error);
    }
  }
}
