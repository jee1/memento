import type Database from 'better-sqlite3';
import { log } from './init-log.js';

export interface VecTableConfig {
  name: string;
  dimension: number;
  filter: string;
}

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
 * 제공자별 VEC 테이블 차원 검증 및 재생성 후, 재구축이 필요한 설정 목록을 반환한다.
 */
function reconcileMisalignedVecTables(db: Database.Database): VecTableConfig[] {
  const vecTablesToRepopulate: VecTableConfig[] = [];

  const vecTables: VecTableConfig[] = [
    {
      name: 'memory_item_vec',
      dimension: 384,
      filter: 'dimensions = 384'
    },
    {
      name: 'memory_item_vec_tfidf',
      dimension: 512,
      filter: "embedding_provider = 'tfidf' AND dimensions = 512 AND projection_type = 'native'"
    },
    {
      name: 'memory_item_vec_minilm',
      dimension: 384,
      filter: "embedding_provider = 'minilm' AND dimensions = 384 AND projection_type = 'native'"
    },
    {
      name: 'memory_item_vec_openai',
      dimension: 1536,
      filter: "embedding_provider = 'openai' AND dimensions = 1536 AND projection_type = 'native'"
    },
    {
      name: 'memory_item_vec_gemini',
      dimension: 768,
      filter: "embedding_provider = 'gemini' AND dimensions = 768 AND projection_type = 'native'"
    }
  ];

  for (const config of vecTables) {
    const existing = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
      .get(config.name) as { sql?: string } | undefined;
    const expectedToken = `float[${config.dimension}]`;

    if (!existing?.sql || !existing.sql.includes(expectedToken)) {
      db.exec(`DROP TABLE IF EXISTS ${config.name}`);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${config.name} USING vec0(embedding float[${config.dimension}])`);
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
      const allowedTableNames = [
        'memory_item_vec',
        'memory_item_vec_tfidf',
        'memory_item_vec_minilm',
        'memory_item_vec_openai',
        'memory_item_vec_gemini'
      ];
      if (!allowedTableNames.includes(config.name)) {
        log(`[WARN] 허용되지 않은 테이블명: ${config.name}`);
        continue;
      }

      const tableNamePattern = /^[a-z0-9_]+$/;
      if (!tableNamePattern.test(config.name)) {
        log(`[WARN] 잘못된 테이블명 패턴: ${config.name}`);
        continue;
      }

      const query =
        `INSERT OR IGNORE INTO ${config.name}(rowid, embedding) ` +
        `SELECT id, json_extract(embedding, '$') ` +
        `FROM memory_embedding ` +
        `WHERE ${config.filter}`;
      db.exec(query);
    } catch (error) {
      log(`[WARN] ${config.name} 재구축 중 오류 발생:`, error);
    }
  }
}
