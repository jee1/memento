/**
 * SQLite 데이터베이스 초기화 스크립트
 */

import Database from 'better-sqlite3';
import fs, { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mementoConfig } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MCP 서버에서는 모든 로그 출력을 완전히 차단
const log = (...args: any[]) => {};

interface VecTableConfig {
  name: string;
  dimension: number;
  filter: string;
}

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

function ensureLegacySchema(db: Database.Database): VecTableConfig[] {
  const vecTablesToRepopulate: VecTableConfig[] = [];

  try {
    const hasEmbeddingTable = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'`)
      .get();

    if (hasEmbeddingTable) {
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
      addMissingColumn(
        db,
        'memory_embedding',
        'created_at',
        'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
      );
    }

    const hasRegistryTable = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_model_registry'`)
      .get();

    if (hasRegistryTable) {
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

    const vecTables: VecTableConfig[] = [
      {
        name: 'memory_item_vec',
        dimension: 384,
        filter: 'dimensions = 384'
      },
      {
        name: 'memory_item_vec_tfidf',
        dimension: 384,
        filter: "embedding_provider = 'tfidf' AND dimensions = 384 AND projection_type = 'native'"
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

    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete');
  } catch (error) {
    console.warn('⚠️ 레거시 스키마 호환성 조정 실패:', error);
  }

  return vecTablesToRepopulate;
}

function populateVecTables(db: Database.Database, configs: VecTableConfig[]): void {
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
      db.exec(`
        INSERT OR IGNORE INTO ${config.name}(rowid, embedding)
        SELECT id, json_extract(embedding, '$')
        FROM memory_embedding
        WHERE ${config.filter}
      `);
    } catch (error) {
      console.warn(`⚠️ ${config.name} 재구축 중 오류 발생:`, error);
    }
  }
}

export async function initializeDatabase(): Promise<Database.Database> {
  log('🗄️  SQLite 데이터베이스 초기화 중...');
  
  // 데이터 디렉토리 생성
  const dbDir = dirname(mementoConfig.dbPath);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (error) {
    // 디렉토리가 이미 존재하는 경우 무시
  }
  
  try {
    // SQLite 데이터베이스 연결
    const db = new Database(mementoConfig.dbPath);
    
    // WAL 모드 사용 (동시 읽기 성능 향상)
    db.pragma('journal_mode = WAL');
    
    // 외래키 제약 조건 활성화
    db.pragma('foreign_keys = ON');
    
    // FTS5 확장 로드 시도 (Docker 환경에서는 더 안정적)
    try {
      // Docker 환경에서는 FTS5가 기본적으로 포함되어 있음
      if (process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true') {
        log('🐳 Docker 환경에서 FTS5 사용 가능');
      } else {
        db.loadExtension('fts5');
        log('✅ FTS5 확장 로드 완료');
      }
    } catch (error) {
      log('⚠️  FTS5 확장 로드 실패, 기본 검색으로 전환:', error);
    }
    
    db.pragma('busy_timeout = 60000');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 20000');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456');
    db.pragma('wal_autocheckpoint = 100');
    db.pragma('journal_size_limit = 33554432');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('locking_mode = NORMAL');
    db.pragma('read_uncommitted = 0');
    
    try {
      const { getLoadablePath } = await import('sqlite-vec');
      const extensionPath = getLoadablePath();
      db.loadExtension(extensionPath);
      console.log('✅ sqlite-vec 확장 로드 성공');
    } catch (error) {
      console.warn('⚠️ sqlite-vec 확장 로드 실패 (벡터 검색 기능 비활성화):', error);
    }
    
    // 스키마 파일 읽기 및 실행
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    const vecTablesToRepopulate = ensureLegacySchema(db);
    
    // 스키마 실행
    db.exec(schema);
    populateVecTables(db, vecTablesToRepopulate);
    
    log('✅ 데이터베이스 초기화 완료');
    log(`📁 데이터베이스 경로: ${mementoConfig.dbPath}`);
    
    return db;
  } catch (error) {
    log('❌ 데이터베이스 초기화 실패:', error);
    throw error;
  }
}

export function closeDatabase(db: Database.Database): void {
  if (!db) {
    log('🔒 데이터베이스가 이미 닫혔습니다');
    return;
  }
  
  try {
    db.close();
    log('🔒 데이터베이스 연결 종료');
  } catch (error) {
    log('❌ 데이터베이스 종료 실패:', error);
  }
}

// CLI에서 직접 실행할 때
if (process.argv[1] && process.argv[1].endsWith('init.ts')) {
  console.log('🚀 데이터베이스 초기화 스크립트 시작');
  (async () => {
    try {
      const db = await initializeDatabase();
      console.log('🎉 데이터베이스 초기화 성공!');
      closeDatabase(db);
      process.exit(0);
    } catch (error) {
      console.error('❌ 데이터베이스 초기화 실패:', error);
      process.exit(1);
    }
  })();
}
