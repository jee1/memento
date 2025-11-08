/**
 * SQLite 데이터베이스 초기화 스크립트
 */

import Database from 'better-sqlite3';
import fs, { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mementoConfig } from '../config/index.js';
import { MigrationDetector } from './migration/migration-detector.js';
import { MigrationRunner } from './migration/migration-runner.js';
import { CoreMemoryRepository } from '../repositories/core-memory-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { CoreMemoryCacheService } from '../services/core-memory-cache-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MCP 서버에서는 로그를 stderr로 출력 (마이그레이션 정보는 중요하므로 출력)
// process.stderr가 사용 가능한 경우에만 출력
const log = process.stderr && process.stderr.writable
  ? (...args: any[]) => {
      try {
        process.stderr.write(args.map(String).join(' ') + '\n');
      } catch {
        // stderr 쓰기 실패 시 무시
      }
    }
  : (...args: any[]) => {
      // stderr가 없는 경우 console.error 사용 (개발 환경)
      try {
        console.error(...args);
      } catch {
        // 로그 출력 실패 시 무시
      }
    };

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
    
    // 마이그레이션 자동 실행 (스키마 실행 전에 확인)
    // 기존 DB가 있는지 확인하여 마이그레이션을 먼저 실행할지 결정
    let isExistingDatabase = false;
    try {
      const existingTables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('memory_item', 'core_memory', 'knowledge_vault')
      `).all() as Array<{ name: string }>;
      
      isExistingDatabase = existingTables.length > 0;
    } catch (error) {
      // 테이블 확인 실패 시 새 DB로 간주
      isExistingDatabase = false;
    }
    
    // 기존 DB가 있으면 마이그레이션을 먼저 실행
    if (isExistingDatabase) {
      try {
        log('🔄 기존 데이터베이스 감지 - 마이그레이션 먼저 실행');
        const detector = new MigrationDetector();
        const detectionResult = await detector.detectPendingMigrations(db);
        
        if (detectionResult.pendingMigrations.length > 0) {
          log(`📦 실행해야 할 마이그레이션 발견: ${detectionResult.pendingMigrations.length}개`);
          
          const runner = new MigrationRunner(db);
          const migrations = detectionResult.pendingMigrations.map(d => d.migration);
          const results = await runner.runMigrations(migrations, {
            createBackup: true,
            autoRollback: true,
            validate: true
          });
          
          const successCount = results.filter(r => r.success).length;
          const failCount = results.filter(r => !r.success).length;
          
          log(`✅ 마이그레이션 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
          
          if (failCount > 0) {
            log('⚠️  일부 마이그레이션이 실패했습니다. 로그를 확인하세요.');
            const failedMigrations = results.filter(r => !r.success);
            for (const failed of failedMigrations) {
              log(`   - ${failed.name} (v${failed.version}): ${failed.error}`);
            }
          }
        } else {
          log('✅ 실행해야 할 마이그레이션이 없습니다.');
        }
      } catch (migrationError) {
        log('⚠️  마이그레이션 실행 중 오류 발생:', migrationError);
        // 마이그레이션 실패해도 서버는 계속 실행 (기존 스키마 사용)
        log('   기존 스키마로 계속 진행합니다.');
      }
    } else {
      // 새 DB인 경우: 마이그레이션을 먼저 체크하여 schema.sql과의 충돌 방지
      // 마이그레이션이 있으면 마이그레이션을 실행하고 schema.sql은 스킵
      // 마이그레이션이 없으면 schema.sql을 실행 (최신 스키마 포함)
      log('📋 새 데이터베이스 감지 - 초기화 전략 결정 중...');
      
      // 스키마 버전 테이블 먼저 생성 (마이그레이션 감지에 필요)
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS memento_schema_version (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            migration_name TEXT NOT NULL,
            checksum TEXT,
            applied_by TEXT DEFAULT 'system',
            description TEXT
          )
        `);
      } catch (error) {
        // 스키마 버전 테이블 생성 실패는 무시
      }
      
      // 마이그레이션 감지
      let hasPendingMigrations = false;
      try {
        const detector = new MigrationDetector();
        const detectionResult = await detector.detectPendingMigrations(db);
        hasPendingMigrations = detectionResult.pendingMigrations.length > 0;
        
        if (hasPendingMigrations) {
          log(`📦 마이그레이션 발견: ${detectionResult.pendingMigrations.length}개 - 마이그레이션 우선 실행`);
          
          // 마이그레이션 실행
          const runner = new MigrationRunner(db);
          const migrations = detectionResult.pendingMigrations.map(d => d.migration);
          const results = await runner.runMigrations(migrations, {
            createBackup: true,
            autoRollback: true,
            validate: true
          });
          
          const successCount = results.filter(r => r.success).length;
          const failCount = results.filter(r => !r.success).length;
          
          log(`✅ 마이그레이션 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
          
          if (failCount > 0) {
            log('⚠️  일부 마이그레이션이 실패했습니다. 로그를 확인하세요.');
            const failedMigrations = results.filter(r => !r.success);
            for (const failed of failedMigrations) {
              log(`   - ${failed.name} (v${failed.version}): ${failed.error}`);
            }
          }
          
          // 마이그레이션 실행 후 VEC 테이블 초기화
          populateVecTables(db, []);
        }
      } catch (migrationError) {
        log('⚠️  마이그레이션 감지/실행 중 오류 발생:', migrationError);
        hasPendingMigrations = false; // 오류 발생 시 schema.sql 사용
      }
      
      // 마이그레이션이 없거나 실패한 경우 schema.sql 실행 (최신 스키마 포함)
      if (!hasPendingMigrations) {
        log('📋 schema.sql 실행 (최신 스키마 적용)');
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');
        
        // 스키마 실행
        db.exec(schema);
        
        // VEC 테이블 초기화
        populateVecTables(db, []);
        
        // 초기 스키마 버전 기록 (schema.sql이 최신이므로)
        try {
          db.exec(`
            INSERT OR IGNORE INTO memento_schema_version (version, migration_name, description, applied_by)
            VALUES ('2.0', 'initial-schema-v2', 'Initial Memento MCP Server schema (v2.0 with MIRIX)', 'system')
          `);
        } catch (error) {
          // 스키마 버전 기록 실패는 무시
        }
      }
    }
    
    // Core Memory 자동 로드 (always_load=true인 항목만)
    try {
      log('🔄 Core Memory 자동 로드 중...');
      const coreMemoryRepository = new CoreMemoryRepository(db);
      const { getCoreMemoryCache, setCoreMemoryCache } = await import('../services/core-memory-cache-service.js');
      
      // 전역 캐시 인스턴스 생성 및 설정
      const coreMemoryCache = getCoreMemoryCache();
      setCoreMemoryCache(coreMemoryCache);
      
      const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);
      
      // always_load=true인 항목 조회 및 캐시에 로드
      const alwaysLoadItems = await coreMemoryService.findAlwaysLoad();
      
      if (alwaysLoadItems.length > 0) {
        log(`📦 Core Memory 자동 로드: ${alwaysLoadItems.length}개 항목`);
        
        for (const item of alwaysLoadItems) {
          const cacheKey = `${item.agent_id}:${item.key}`;
          coreMemoryCache.set(cacheKey, item);
        }
        
        log(`✅ Core Memory 캐시 로드 완료: ${coreMemoryCache.size()}개 항목`);
      } else {
        log('✅ Core Memory 자동 로드할 항목이 없습니다.');
      }
    } catch (coreMemoryError) {
      log('⚠️  Core Memory 자동 로드 중 오류 발생:', coreMemoryError);
      // Core Memory 로드 실패해도 서버는 계속 실행
      log('   Core Memory 없이 계속 진행합니다.');
    }
    
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
