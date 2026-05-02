/**
 * SQLite 데이터베이스 초기화 스크립트
 */

/* eslint-disable security/detect-non-literal-fs-filename */
// 데이터베이스 경로는 환경 변수 또는 기본값에서 가져오며, 경로 검증이 적용됨
import Database from 'better-sqlite3';
import fs,{ readFileSync } from 'fs';
import { dirname,join } from 'path';
import { fileURLToPath } from 'url';
import { CoreMemoryService } from '../../../domains/memory/services/core-memory-service.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { ensureMetaMemoryStatsSchema } from '../../../shared/utils/ensure-meta-memory-stats-schema.js';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';
import { ensureQualityAssuranceSchema } from '../../../shared/utils/ensure-quality-assurance-schema.js';
import { initializeMigrationStatusTable,loadMigrationStatusToConfig } from '../../../shared/utils/fts5-migration-status.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { normalizeReflectionNotes } from '../../../shared/utils/reflection-notes-normalize.js';
import { createCoreMemoryRepository } from '../factories/core-memory-repository.factory.js';
import { ensureMemoryItemTripleExtractionColumns } from './ensure-memory-item-triple-extraction-columns.js';
import { runDatabaseIntegrityPreflight } from './db-integrity-preflight.js';
import { MigrationDetector } from './migration/migration-detector.js';
import { MigrationRunner } from './migration/migration-runner.js';
import { SchemaVersionManager } from './migration/schema-version-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MCP 프로토콜 준수를 위해 초기화 로그는 출력하지 않음
// 로그가 stdout/stderr로 출력되면 JSON-RPC 통신을 방해할 수 있음
const log = (..._args: any[]) => {
  // MCP 프로토콜 준수를 위해 로그 출력 비활성화
  // 필요시 환경 변수로 제어 가능하도록 주석 처리
  // if (process.env.MCP_DEBUG === 'true') {
  //   try {
  //     process.stderr.write(args.map(String).join(' ') + '\n');
  //   } catch {
  //     // stderr 쓰기 실패 시 무시
  //   }
  // }
};

interface VecTableConfig {
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
 * 
 * @param db 데이터베이스 인스턴스
 * @param tableName 테이블명
 * @param columnName 추가할 컬럼명
 * @param definition 컬럼 정의 (예: "TEXT NOT NULL DEFAULT '[]'")
 * @param postUpdateSql 컬럼 추가 후 실행할 SQL (기본값 업데이트 등)
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

/**
 * 레거시 스키마 호환성 보장
 * 
 * 왜 이 함수가 필요한가?
 * - 기존 데이터베이스가 최신 스키마와 다를 수 있음
 * - 마이그레이션 없이도 기존 데이터를 보존하면서 스키마 업데이트 필요
 * - embedding 컬럼이 없는 레거시 스키마 지원
 * 
 * @param db 데이터베이스 인스턴스
 * @returns 재구축이 필요한 VEC 테이블 설정 목록
 */
function _ensureLegacySchema(db: Database.Database): VecTableConfig[] {
  const vecTablesToRepopulate: VecTableConfig[] = [];

  try {
    const hasEmbeddingTable = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'`)
      .get();

    if (hasEmbeddingTable) {
      // embedding 컬럼이 없으면 추가 (레거시 스키마 호환성)
      // "no such column: embedding" 에러 방지를 위해 필수
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

    // 제공자별 VEC 테이블 차원 설정
    // 왜 각 제공자별로 다른 차원인가? 각 임베딩 제공자가 다른 차원을 생성함
    // - TF-IDF: 512차원 (VECTOR_SEARCH.PROVIDER_DIMENSIONS.tfidf)
    // - MiniLM: 384차원 (VECTOR_SEARCH.PROVIDER_DIMENSIONS.minilm)
    // - OpenAI: 1536차원 (VECTOR_SEARCH.PROVIDER_DIMENSIONS.openai)
    // - Gemini: 768차원 (VECTOR_SEARCH.PROVIDER_DIMENSIONS.gemini)
    const vecTables: VecTableConfig[] = [
      {
        name: 'memory_item_vec',
        dimension: 384, // 기본 테이블은 MiniLM 차원 사용 (가장 일반적)
        filter: 'dimensions = 384'
      },
      {
        name: 'memory_item_vec_tfidf',
        dimension: 512, // TF-IDF는 512차원 (수정: 기존 384에서 512로 변경)
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

    // 제공자별 VEC 테이블 차원 검증 및 재생성
    // 왜 필요한가? "expected 384 vs actual 512" 에러 방지를 위해 차원 일치 보장
    for (const config of vecTables) {
      const existing = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
        .get(config.name) as { sql?: string } | undefined;
      const expectedToken = `float[${config.dimension}]`;

      // 차원 불일치 감지: 기존 테이블의 차원이 예상 차원과 다르면 재생성
      if (!existing?.sql || !existing.sql.includes(expectedToken)) {
        // 왜 재생성이 필요한가? VEC 테이블은 생성 시 차원이 고정되므로 재생성 필요
        db.exec(`DROP TABLE IF EXISTS ${config.name}`);
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${config.name} USING vec0(embedding float[${config.dimension}])`);
        vecTablesToRepopulate.push(config);
      }
    }

    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete');
  } catch (error) {
    log('⚠️ 레거시 스키마 호환성 조정 실패:', error);
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
      // SQL Injection 방지: config.name은 하드코딩된 값이지만 화이트리스트 검증 추가
      // config.filter는 하드코딩된 WHERE 절 조건이므로 안전함
      const allowedTableNames = [
        'memory_item_vec',
        'memory_item_vec_tfidf',
        'memory_item_vec_minilm',
        'memory_item_vec_openai',
        'memory_item_vec_gemini'
      ];
      if (!allowedTableNames.includes(config.name)) {
        log(`⚠️ 허용되지 않은 테이블명: ${config.name}`);
        continue;
      }
      
      // 테이블명 패턴 검증
      const tableNamePattern = /^[a-z0-9_]+$/;
      if (!tableNamePattern.test(config.name)) {
        log(`⚠️ 잘못된 테이블명 패턴: ${config.name}`);
        continue;
      }
      
      const query = 
        `INSERT OR IGNORE INTO ${config.name}(rowid, embedding) ` +
        `SELECT id, json_extract(embedding, '$') ` +
        `FROM memory_embedding ` +
        `WHERE ${config.filter}`;
      db.exec(query);
    } catch (error) {
      log(`⚠️ ${config.name} 재구축 중 오류 발생:`, error);
    }
  }
}

const BASELINE_FROM_SCHEMA_SQL_CHECKSUM = 'bundled-schema-sql';

/**
 * 신규 DB에 schema.sql만 적용한 경우, 증분 마이그레이션 목록과 memento_schema_version을 맞춘다.
 * 그렇지 않으면 다음 기동 시 pending 마이그레이션이 중복 실행된다.
 */
async function recordBundledSchemaSqlMigrationBaseline(db: Database.Database): Promise<void> {
  const detector = new MigrationDetector();
  const all = await detector.detectAllMigrations();
  if (all.length === 0) {
    throw new Error(
      '[memento] 마이그레이션 모듈을 로드할 수 없습니다. 빌드 산출물에 migration 스크립트가 포함됐는지 확인하세요.'
    );
  }
  const versionManager = new SchemaVersionManager(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { migration } of all) {
      await versionManager.recordVersion({
        version: migration.version,
        appliedAt: new Date(),
        migrationName: migration.name,
        checksum: BASELINE_FROM_SCHEMA_SQL_CHECKSUM,
        appliedBy: 'system',
        description: migration.description
          ? `${migration.description} (baseline: schema.sql)`
          : 'Baseline: full schema applied via bundled schema.sql (fresh DB)',
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw e;
  }
}

/**
 * @param overrideDbPath DB 경로 오버라이드 (createMementoCore 등 라이브러리 호출 시 사용). 미지정 시 mementoConfig.dbPath 사용.
 */
export async function initializeDatabase(overrideDbPath?: string): Promise<Database.Database> {
  log('🗄️  SQLite 데이터베이스 초기화 중...');

  const dbPath = overrideDbPath ?? mementoConfig.dbPath;

  // 데이터 디렉토리 생성 (:memory: 등 비파일 경로는 스킵)
  if (dbPath !== ':memory:' && !dbPath.startsWith('file:')) {
    const dbDir = dirname(dbPath);
    try {
      fs.mkdirSync(dbDir, { recursive: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`[memento] DB 디렉터리 생성 실패: ${dbDir}\n원인: ${msg}`);
    }
  }

  runDatabaseIntegrityPreflight(dbPath);

  try {
    // SQLite 데이터베이스 연결
    const db = new Database(dbPath);
    
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
    
    // reflection_notes 정규화를 위한 사용자 정의 함수 등록
    // 트리거에서 사용할 수 있도록 데이터베이스 연결 시점에 등록
    db.function('normalize_reflection_notes', {
      deterministic: true,
      varargs: false
    }, (reflectionNotes: string | null) => {
      return normalizeReflectionNotes(reflectionNotes);
    });
    
    try {
      const { getLoadablePath } = await import('sqlite-vec');
      const extensionPath = getLoadablePath();
      db.loadExtension(extensionPath);
      log('✅ sqlite-vec 확장 로드 성공');
    } catch (error) {
      log('⚠️ sqlite-vec 확장 로드 실패 (벡터 검색 기능 비활성화):', error);
    }
    
    // 마이그레이션 자동 실행 (스키마 실행 전에 확인)
    // 기존 DB가 있는지 확인하여 마이그레이션을 먼저 실행할지 결정
    const existingTables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('memory_item', 'core_memory', 'knowledge_vault')
    `).all() as Array<{ name: string }>;
    const isExistingDatabase = existingTables.length > 0;
    
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
            const failedMigrations = results.filter(r => !r.success);
            for (const failed of failedMigrations) {
              log(`   - ${failed.name} (v${failed.version}): ${failed.error}`);
            }
            const detail = failedMigrations
              .map(f => `${f.name} (v${f.version}): ${f.error ?? 'unknown error'}`)
              .join('; ');
            throw new Error(
              `기존 DB 마이그레이션 실패 (${failCount}건). \`npm run db:migrate -w @memento/core\`로 점검하세요. ${detail}`
            );
          }
        } else {
          log('✅ 실행해야 할 마이그레이션이 없습니다.');
        }
      } catch (migrationError) {
        log('❌ 기존 데이터베이스 마이그레이션 단계에서 예외가 발생했습니다.', migrationError);
        throw migrationError;
      }
    } else {
      // 새 DB인 경우: 마이그레이션을 먼저 체크하여 schema.sql과의 충돌 방지
      // 마이그레이션이 있으면 마이그레이션을 실행하고 schema.sql은 스킵
      // 마이그레이션이 없으면 schema.sql을 실행 (최신 스키마 포함)
      log('📋 새 데이터베이스 감지 - 초기화 전략 결정 중...');
      
      // 스키마 버전 테이블 먼저 생성 (마이그레이션 감지에 필요)
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
      
      // 마이그레이션 감지 (증분 마이그레이션은 기본 테이블이 있을 때만 — 빈 파일에선 schema.sql이 선행)
      let hasPendingMigrations = false;
      try {
        const detector = new MigrationDetector();
        const detectionResult = await detector.detectPendingMigrations(db);
        const memoryItemReady = Boolean(
          db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_item' LIMIT 1`)
            .get()
        );
        const pendingCount = detectionResult.pendingMigrations.length;
        hasPendingMigrations = pendingCount > 0 && memoryItemReady;
        if (pendingCount > 0 && !memoryItemReady) {
          log(
            '📋 기본 테이블(memory_item) 없음 — 대기 중인 증분 마이그레이션은 건너뛰고 schema.sql로 초기화합니다'
          );
        }

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
            const failedMigrations = results.filter(r => !r.success);
            for (const failed of failedMigrations) {
              log(`   - ${failed.name} (v${failed.version}): ${failed.error}`);
            }
            const detail = failedMigrations
              .map(f => `${f.name} (v${f.version}): ${f.error ?? 'unknown error'}`)
              .join('; ');
            throw new Error(
              `신규 DB 마이그레이션 실패 (${failCount}건). schema.sql 폴백 없이 중단합니다. ${detail}`
            );
          } else {
            // 마이그레이션 전부 성공한 경우에만 VEC 테이블 초기화 (실패 시 아래 schema.sql 경로에서 처리)
            populateVecTables(db, []);

            // 마이그레이션 완료 검증: core_memory 테이블의 version=0인 행이 없어야 함
            try {
              const zeroVersionCount = db.prepare(`
              SELECT COUNT(*) as count FROM core_memory WHERE version = 0
            `).get() as { count: number } | undefined;

              if (zeroVersionCount && zeroVersionCount.count > 0) {
                const errorMessage = `마이그레이션 검증 실패: core_memory 테이블에 version=0인 행이 ${zeroVersionCount.count}개 있습니다. 마이그레이션 010이 완료되지 않았을 수 있습니다.`;
                log(`❌ ${errorMessage}`);
                throw new Error(errorMessage);
              }

              log('✅ core_memory 버전 마이그레이션 검증 완료 (version=0인 행 없음)');
            } catch (validationError) {
              // core_memory 테이블이 없는 경우는 무시 (마이그레이션 002가 아직 실행되지 않았을 수 있음)
              if (validationError instanceof Error && validationError.message.includes('no such table')) {
                log('⚠️  core_memory 테이블이 없습니다. 마이그레이션 002가 아직 실행되지 않았을 수 있습니다.');
              } else {
                throw validationError;
              }
            }
          }
        }
      } catch (migrationError) {
        log('❌ 신규 DB: 마이그레이션 감지/실행 중 오류 발생:', migrationError);
        throw migrationError;
      }
      
      // 마이그레이션이 없거나 실패한 경우 schema.sql 실행 (최신 스키마 포함)
      if (!hasPendingMigrations) {
        log('📋 schema.sql 실행 (최신 스키마 적용)');
        // dist: copy:assets가 dist/database/schema.sql에 복사함. 소스(Vitest): 동일 디렉터리의 schema.sql
        let schemaPath = join(__dirname, '..', '..', '..', 'database', 'schema.sql');
        if (!fs.existsSync(schemaPath)) {
          const fallback = join(__dirname, 'schema.sql');
          if (fs.existsSync(fallback)) schemaPath = fallback;
        }
        const schema = readFileSync(schemaPath, 'utf-8');
        
        // 스키마 실행
        db.exec(schema);
        
        // VEC 테이블 초기화
        populateVecTables(db, []);

        await recordBundledSchemaSqlMigrationBaseline(db);
      }
    }

    ensureMemoryItemTripleExtractionColumns(db);
    ensureMetaMemoryStatsSchema(db);
    ensureQualityAssuranceSchema(db);
    ensureMemoryReviewCandidateSchema(db);

    // Core Memory 자동 로드 (always_load=true인 항목만)
    try {
      log('🔄 Core Memory 자동 로드 중...');
      const coreMemoryRepository = createCoreMemoryRepository(db);
      const { getCoreMemoryCache, setCoreMemoryCache } = await import('../../../domains/memory/services/core-memory-cache-service.js');
      
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
    
    // FTS5 마이그레이션 상태 테이블 초기화 및 상태 로드
    try {
      initializeMigrationStatusTable(db);
      loadMigrationStatusToConfig(db);
      log('✅ FTS5 마이그레이션 상태 로드 완료');
    } catch (error) {
      // 마이그레이션 상태 초기화 실패는 경고만 출력 (초기화는 계속 진행)
      log('⚠️ FTS5 마이그레이션 상태 초기화 실패:', error);
    }

    log('✅ 데이터베이스 초기화 완료');
    log(`📁 데이터베이스 경로: ${dbPath}`);

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
  logger.info('🚀 데이터베이스 초기화 스크립트 시작');
  (async () => {
    try {
      const db = await initializeDatabase();
      logger.info('🎉 데이터베이스 초기화 성공!');
      closeDatabase(db);
      process.exit(0);
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 데이터베이스 초기화 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      process.exit(1);
    }
  })();
}
