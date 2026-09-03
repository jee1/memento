#!/usr/bin/env node
import { parseArgs as parseCliArgs, type CliDatabase } from './lib/cli.js';

/**
 * 트리거 상태 확인 및 수정 스크립트
 * memory_embedding_vec_* 트리거의 TF-IDF 차원 조건·mock vec 포함 여부를 확인하고
 * 필요시 @memento/core vec-schema 원본으로 재생성합니다.
 *
 * 사용법:
 *   npx tsx scripts/check-and-fix-trigger.ts [--fix]
 */

import {
  initializeDatabase,
  listExistingVecTables,
  mementoConfig,
  recreateVecTriggers,
} from '@memento/core';

interface TriggerInfo {
  name: string;
  sql: string;
  hasCorrectTfidfDimension: boolean;
  hasMockVec: boolean;
}

/**
 * 트리거 정보 조회
 */
function getTriggerInfo(db: CliDatabase, triggerName: string): TriggerInfo | null {
  const result = db
    .prepare(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='trigger' AND name=?
    `)
    .get(triggerName) as { name: string; sql: string } | undefined;

  if (!result) {
    return null;
  }

  // TF-IDF 차원 조건 확인: dimensions = 512가 있어야 함
  const hasCorrectTfidfDimension =
    result.sql.includes("embedding_provider = 'tfidf'") &&
    result.sql.includes('dimensions = 512');
  const hasMockVec = result.sql.includes('memory_item_vec_mock');

  return {
    name: result.name,
    sql: result.sql,
    hasCorrectTfidfDimension,
    hasMockVec,
  };
}

/**
 * 트리거 수정 — vec-schema 단일 원본(listExistingVecTables + recreateVecTriggers)
 */
function fixTriggers(db: CliDatabase): void {
  console.log('🔧 트리거 수정 중...\n');

  const existing = listExistingVecTables(db);
  if (existing.length === 0) {
    console.log('⚠️  존재하는 vec 테이블이 없습니다. 트리거를 재생성하지 않습니다.\n');
    return;
  }

  recreateVecTriggers(db, existing);
  console.log(
    `✅ 트리거 수정 완료 (tables: ${existing.map(t => t.name).join(', ')})\n`,
  );
}

/**
 * 마이그레이션 버전 확인
 */
function checkMigrationVersion(db: CliDatabase): void {
  const tableExists = db
    .prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memento_schema_version'
    `)
    .get() as { name: string } | undefined;

  if (!tableExists) {
    console.log('⚠️  memento_schema_version 테이블이 없습니다. 마이그레이션 시스템이 초기화되지 않았을 수 있습니다.\n');
    return;
  }

  const version = db
    .prepare(`
      SELECT version, migration_name, applied_at 
      FROM memento_schema_version 
      ORDER BY applied_at DESC 
      LIMIT 1
    `)
    .get() as { version: string; migration_name: string; applied_at: string } | undefined;

  if (version) {
    console.log(`📋 현재 스키마 버전: ${version.version}`);
    console.log(`   마이그레이션: ${version.migration_name}`);
    console.log(`   적용 일시: ${version.applied_at}\n`);
  } else {
    console.log('⚠️  적용된 마이그레이션이 없습니다.\n');
  }

  // 12.0 마이그레이션 확인
  const migration12 = db
    .prepare(`
      SELECT version, migration_name, applied_at 
      FROM memento_schema_version 
      WHERE version = '12.0'
    `)
    .get() as { version: string; migration_name: string; applied_at: string } | undefined;

  if (migration12) {
    console.log(`✅ 마이그레이션 12.0 (fix-tfidf-dimension-trigger)이 적용되었습니다.`);
    console.log(`   적용 일시: ${migration12.applied_at}\n`);
  } else {
    console.log('⚠️  마이그레이션 12.0 (fix-tfidf-dimension-trigger)이 아직 적용되지 않았습니다.\n');
  }
}

function triggersHealthy(insert: TriggerInfo, update: TriggerInfo): boolean {
  return (
    insert.hasCorrectTfidfDimension &&
    update.hasCorrectTfidfDimension &&
    insert.hasMockVec &&
    update.hasMockVec
  );
}

async function main() {
  const shouldFix = parseCliArgs().args.includes('--fix');
  
  console.log('🔍 트리거 상태 확인 중...\n');
  console.log(`데이터베이스 경로: ${mementoConfig.dbPath}\n`);

  let db: CliDatabase | null = null;

  try {
    db = await initializeDatabase();

    // 마이그레이션 버전 확인
    checkMigrationVersion(db);

    // 트리거 확인
    const insertTrigger = getTriggerInfo(db, 'memory_embedding_vec_insert');
    const updateTrigger = getTriggerInfo(db, 'memory_embedding_vec_update');

    if (!insertTrigger) {
      console.log('❌ memory_embedding_vec_insert 트리거가 존재하지 않습니다.');
      process.exit(1);
    }

    if (!updateTrigger) {
      console.log('❌ memory_embedding_vec_update 트리거가 존재하지 않습니다.');
      process.exit(1);
    }

    console.log('📊 트리거 상태:');
    console.log(`   memory_embedding_vec_insert: ${insertTrigger.hasCorrectTfidfDimension ? '✅ 올바름 (dimensions = 512)' : '❌ 잘못됨 (dimensions = 384)'}${insertTrigger.hasMockVec ? '' : ' · ❌ mock vec 누락'}`);
    console.log(`   memory_embedding_vec_update: ${updateTrigger.hasCorrectTfidfDimension ? '✅ 올바름 (dimensions = 512)' : '❌ 잘못됨 (dimensions = 384)'}${updateTrigger.hasMockVec ? '' : ' · ❌ mock vec 누락'}\n`);

    if (!triggersHealthy(insertTrigger, updateTrigger)) {
      console.log('⚠️  트리거에 문제가 있습니다. TF-IDF 차원(512) 또는 memory_item_vec_mock이 맞지 않습니다.\n');

      if (shouldFix) {
        fixTriggers(db);
        
        // 수정 후 재확인
        const fixedInsertTrigger = getTriggerInfo(db, 'memory_embedding_vec_insert');
        const fixedUpdateTrigger = getTriggerInfo(db, 'memory_embedding_vec_update');

        const fixedOk =
          !!fixedInsertTrigger &&
          !!fixedUpdateTrigger &&
          triggersHealthy(fixedInsertTrigger, fixedUpdateTrigger);

        console.log('📊 수정 후 트리거 상태:');
        console.log(
          `   memory_embedding_vec_insert: ${fixedInsertTrigger?.hasCorrectTfidfDimension && fixedInsertTrigger.hasMockVec ? '✅ 올바름' : '❌ 여전히 문제 있음'}`,
        );
        console.log(
          `   memory_embedding_vec_update: ${fixedUpdateTrigger?.hasCorrectTfidfDimension && fixedUpdateTrigger.hasMockVec ? '✅ 올바름' : '❌ 여전히 문제 있음'}\n`,
        );

        if (fixedOk) {
          console.log('✅ 트리거가 성공적으로 수정되었습니다!');
          process.exit(0);
        } else {
          console.log('❌ 트리거 수정에 실패했습니다.');
          process.exit(1);
        }
      } else {
        console.log('💡 트리거를 수정하려면 --fix 플래그를 사용하세요:');
        console.log('   npx tsx scripts/check-and-fix-trigger.ts --fix\n');
        process.exit(1);
      }
    } else {
      console.log('✅ 모든 트리거가 올바르게 설정되어 있습니다!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ 오류 발생:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
