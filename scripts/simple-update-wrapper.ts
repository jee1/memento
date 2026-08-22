#!/usr/bin/env node
import { isMain } from './lib/cli.js';

/**
 * simple-update.js 래퍼
 * 
 * 4.4.2: simple-update.js를 MigrationRunner를 호출하는 래퍼로 변경
 * 
 * 이 스크립트는 기존 simple-update.js의 기능을 정식 마이그레이션 시스템을 통해 실행합니다.
 * 하위 호환성을 위해 기존 인터페이스를 유지합니다.
 * 
 * 사용법:
 *   npx tsx scripts/simple-update-wrapper.ts
 *   또는
 *   node dist/scripts/simple-update-wrapper.js
 */

import { initializeDatabase, closeDatabase } from '../packages/memento-core/src/infrastructure/database/sqlite/init.js';
import { MigrationRunner } from '../packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.js';
import { MigrationDetector } from '../packages/memento-core/src/infrastructure/database/sqlite/migration/migration-detector.js';
import { logger } from '../packages/memento-core/src/shared/utils/logger.js';

/**
 * simple-update.js의 기능을 정식 마이그레이션 시스템으로 실행
 * 
 * 이 함수는 기존 simple-update.js의 기능을 정식 마이그레이션 시스템을 통해 실행합니다.
 * 실제 마이그레이션은 migrations/ 디렉토리에 있는 마이그레이션 스크립트를 통해 수행됩니다.
 */
async function runUpdateMigration() {
  logger.info('🔧 간단한 데이터 업데이트 시작 (정식 마이그레이션 시스템 사용)');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    db = await initializeDatabase();
    
    // MigrationDetector를 사용하여 실행 대기 중인 마이그레이션 감지
    const detector = new MigrationDetector();
    const detection = await detector.detectPendingMigrations(db);
    
    if (detection.pendingMigrations.length === 0) {
      logger.info('✅ 실행 대기 중인 마이그레이션이 없습니다. 데이터베이스가 최신 상태입니다.');
      console.log('✅ 실행 대기 중인 마이그레이션이 없습니다.');
      return;
    }
    
    logger.info(`📋 실행 대기 중인 마이그레이션: ${detection.pendingMigrations.length}개`);
    console.log(`📋 실행 대기 중인 마이그레이션: ${detection.pendingMigrations.length}개`);
    
    // MigrationRunner를 사용하여 마이그레이션 실행
    const runner = new MigrationRunner(db);
    
    for (const detected of detection.pendingMigrations) {
      logger.info(`🚀 마이그레이션 실행: ${detected.migration.name} (v${detected.migration.version})`);
      console.log(`🚀 마이그레이션 실행: ${detected.migration.name} (v${detected.migration.version})`);
      
      const result = await runner.runMigration(detected.migration, {
        createBackup: true,
        autoRollback: true,
        validate: true
      });
      
      if (result.success) {
        logger.info(`✅ 마이그레이션 성공: ${detected.migration.name} (v${detected.migration.version})`);
        console.log(`✅ 마이그레이션 성공: ${detected.migration.name} (v${detected.migration.version})`);
      } else {
        logger.error(`❌ 마이그레이션 실패: ${detected.migration.name} (v${detected.migration.version})`, {
          error: result.error
        });
        console.error(`❌ 마이그레이션 실패: ${detected.migration.name} (v${detected.migration.version})`);
        if (result.error) {
          console.error(`   오류: ${result.error}`);
        }
        throw new Error(`마이그레이션 실패: ${detected.migration.name}`);
      }
    }
    
    logger.info('🎉 모든 마이그레이션 완료!');
    console.log('\n🎉 모든 마이그레이션 완료!');
    
  } catch (error) {
    logger.error('❌ 업데이트 실패', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('❌ 업데이트 실패:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('   스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    // 데이터베이스 연결 종료
    if (db) {
      closeDatabase(db);
    }
  }
}

// 스크립트 실행
if (isMain(import.meta.url)) {
  runUpdateMigration().catch((error) => {
    logger.error('❌ 스크립트 실행 중 오류 발생', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { runUpdateMigration };

