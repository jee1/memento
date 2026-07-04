/**
 * SQLite 데이터베이스 초기화 스크립트
 */

/* eslint-disable security/detect-non-literal-fs-filename */
// 데이터베이스 경로는 환경 변수 또는 기본값에서 가져오며, 경로 검증이 적용됨
import Database from 'better-sqlite3';
import fs from 'fs';
import { dirname } from 'path';
import { CoreMemoryService } from '../../../domains/memory/services/core-memory-service.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { ensureMetaMemoryStatsSchema } from '../../../shared/utils/ensure-meta-memory-stats-schema.js';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';
import { ensureQualityAssuranceSchema } from '../../../shared/utils/ensure-quality-assurance-schema.js';
import { initializeMigrationStatusTable, loadMigrationStatusToConfig } from '../../../shared/utils/fts5-migration-status.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { createCoreMemoryRepository } from '../factories/core-memory-repository.factory.js';
import { ensureMemoryItemTripleExtractionColumns } from './ensure-memory-item-triple-extraction-columns.js';
import { runDatabaseIntegrityPreflight } from './db-integrity-preflight.js';
import { bootstrapNewDatabaseSchema } from './init-bootstrap-new-db.js';
import { log } from './init-log.js';
import { migrateExistingDatabaseIfNeeded } from './init-migrate-existing.js';
import { configureSqliteSession } from './init-sqlite-session.js';

/**
 * @param overrideDbPath DB 경로 오버라이드 (createMementoCore 등 라이브러리 호출 시 사용). 미지정 시 mementoConfig.dbPath 사용.
 */
export async function initializeDatabase(overrideDbPath?: string): Promise<Database.Database> {
  log('[init]  SQLite 데이터베이스 초기화 중...');

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
    const db = new Database(dbPath);

    await configureSqliteSession(db);

    const existingTables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('memory_item', 'core_memory', 'knowledge_vault')
    `).all() as Array<{ name: string }>;
    const isExistingDatabase = existingTables.length > 0;

    if (isExistingDatabase) {
      await migrateExistingDatabaseIfNeeded(db);
    } else {
      await bootstrapNewDatabaseSchema(db);
    }

    ensureMemoryItemTripleExtractionColumns(db);
    ensureMetaMemoryStatsSchema(db);
    ensureQualityAssuranceSchema(db);
    ensureMemoryReviewCandidateSchema(db);

    try {
      log('[MIG] Core Memory 자동 로드 중...');
      const coreMemoryRepository = createCoreMemoryRepository(db);
      const { getCoreMemoryCache, setCoreMemoryCache } = await import('../../../domains/memory/services/core-memory-cache-service.js');

      const coreMemoryCache = getCoreMemoryCache();
      setCoreMemoryCache(coreMemoryCache);

      const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);

      const alwaysLoadItems = await coreMemoryService.findAlwaysLoad();

      if (alwaysLoadItems.length > 0) {
        log(`[PKG] Core Memory 자동 로드: ${alwaysLoadItems.length}개 항목`);

        for (const item of alwaysLoadItems) {
          const cacheKey = `${item.agent_id}:${item.key}`;
          coreMemoryCache.set(cacheKey, item);
        }

        log(`[OK] Core Memory 캐시 로드 완료: ${coreMemoryCache.size()}개 항목`);
      } else {
        log('[OK] Core Memory 자동 로드할 항목이 없습니다.');
      }
    } catch (coreMemoryError) {
      log('[WARN]  Core Memory 자동 로드 중 오류 발생:', coreMemoryError);
      log('   Core Memory 없이 계속 진행합니다.');
    }

    try {
      initializeMigrationStatusTable(db);
      loadMigrationStatusToConfig(db);
      log('[OK] FTS5 마이그레이션 상태 로드 완료');
    } catch (error) {
      log('[WARN] FTS5 마이그레이션 상태 초기화 실패:', error);
    }

    log('[OK] 데이터베이스 초기화 완료');
    log(`[PATH] 데이터베이스 경로: ${dbPath}`);

    return db;
  } catch (error) {
    log('[ERR] 데이터베이스 초기화 실패:', error);
    throw error;
  }
}

export function closeDatabase(db: Database.Database): void {
  if (!db) {
    log('[DB] 데이터베이스가 이미 닫혔습니다');
    return;
  }

  try {
    db.close();
    log('[DB] 데이터베이스 연결 종료');
  } catch (error) {
    log('[ERR] 데이터베이스 종료 실패:', error);
  }
}

// CLI에서 직접 실행할 때
if (process.argv[1] && process.argv[1].endsWith('init.ts')) {
  logger.info('[CLI] 데이터베이스 초기화 스크립트 시작');
  (async () => {
    try {
      const db = await initializeDatabase();
      logger.info('[CLI] 데이터베이스 초기화 성공!');
      closeDatabase(db);
      process.exit(0);
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('[ERR] 데이터베이스 초기화 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      process.exit(1);
    }
  })();
}
