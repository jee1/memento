#!/usr/bin/env node
/**
 * 데이터베이스 마이그레이션 상태 확인 스크립트
 * 
 * 사용법:
 *   npm run check-migration
 *   또는
 *   node dist/scripts/check-migration-status.js
 */

import Database from 'better-sqlite3';
import { mementoConfig } from '../config/index.js';
import { SchemaVersionManager } from '../infrastructure/database/migration/schema-version-manager.js';
import { MigrationDetector } from '../infrastructure/database/migration/migration-detector.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 색상 출력 헬퍼
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string): void {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logInfo(label: string, value: string | number | null | undefined): void {
  const val = value === null || value === undefined ? '(없음)' : String(value);
  console.log(`${colors.gray}${label.padEnd(25)}${colors.reset} ${val}`);
}

function logSuccess(message: string): void {
  log(`✅ ${message}`, colors.green);
}

function logWarning(message: string): void {
  log(`⚠️  ${message}`, colors.yellow);
}

function logError(message: string): void {
  log(`❌ ${message}`, colors.red);
}

/**
 * 데이터베이스 파일 존재 여부 확인
 */
function checkDatabaseExists(dbPath: string): boolean {
  try {
    return fs.existsSync(dbPath);
  } catch {
    return false;
  }
}

/**
 * 테이블 존재 여부 확인
 */
function tableExists(db: Database.Database, tableName: string): boolean {
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return !!result;
  } catch {
    return false;
  }
}

/**
 * 마이그레이션 상태 확인
 */
async function checkMigrationStatus(): Promise<void> {
  // 명령줄 인자로 경로가 제공된 경우 사용
  const args = process.argv.slice(2);
  const customDbPath = args.find(arg => !arg.startsWith('--'));
  
  const dbPath = customDbPath || mementoConfig.dbPath;
  const absoluteDbPath = dbPath.startsWith('/') 
    ? dbPath 
    : join(process.cwd(), dbPath);

  logSection('데이터베이스 마이그레이션 상태 확인');
  
  // 1. 데이터베이스 파일 존재 확인
  logInfo('데이터베이스 경로', absoluteDbPath);
  logInfo('환경 변수 DB_PATH', process.env.DB_PATH || '(기본값 사용)');
  if (customDbPath) {
    logInfo('사용자 지정 경로', customDbPath);
  }
  
  if (!checkDatabaseExists(absoluteDbPath)) {
    logError(`데이터베이스 파일이 존재하지 않습니다: ${absoluteDbPath}`);
    logInfo('', '새 데이터베이스가 생성될 때 자동으로 마이그레이션이 실행됩니다.');
    process.exit(1);
  }

  logSuccess('데이터베이스 파일 존재 확인');

  // 2. 데이터베이스 연결
  let db: Database.Database;
  try {
    db = new Database(absoluteDbPath, { readonly: true });
  } catch (error) {
    logError(`데이터베이스 연결 실패: ${error}`);
    process.exit(1);
  }

  try {
    // 3. memento_schema_version 테이블 확인
    logSection('스키마 버전 테이블 확인');
    
    const hasVersionTable = tableExists(db, 'memento_schema_version');
    logInfo('memento_schema_version 테이블', hasVersionTable ? '존재' : '없음');

    if (!hasVersionTable) {
      logWarning('마이그레이션 시스템이 초기화되지 않았습니다.');
      logInfo('', '서버를 시작하면 자동으로 마이그레이션이 실행됩니다.');
      db.close();
      process.exit(0);
    }

    // 4. 스키마 버전 정보 조회
    const versionManager = new SchemaVersionManager(db);
    const currentVersion = await versionManager.getCurrentVersion();
    const appliedVersions = await versionManager.getAppliedVersions();
    const allVersions = await versionManager.getAllVersions();

    logSection('현재 스키마 버전');
    logInfo('현재 버전', currentVersion || '(없음)');
    logInfo('적용된 버전 수', appliedVersions.length);

    if (allVersions.length > 0) {
      console.log('\n적용된 마이그레이션 목록:');
      allVersions.forEach((v, index) => {
        const date = new Date(v.appliedAt).toLocaleString('ko-KR');
        console.log(`  ${index + 1}. ${colors.cyan}${v.version}${colors.reset} - ${v.migrationName}`);
        console.log(`     적용일: ${colors.gray}${date}${colors.reset}`);
        if (v.description) {
          console.log(`     설명: ${colors.gray}${v.description}${colors.reset}`);
        }
      });
    }

    // 5. 대기 중인 마이그레이션 확인
    logSection('대기 중인 마이그레이션 확인');
    
    const migrationsDir = join(__dirname, '../database/migration/migrations');
    const detector = new MigrationDetector(migrationsDir);
    const detectionResult = await detector.detectPendingMigrations(db);

    logInfo('전체 마이그레이션 수', 
      detectionResult.appliedMigrations.length + detectionResult.pendingMigrations.length);
    logInfo('적용된 마이그레이션 수', detectionResult.appliedMigrations.length);
    logInfo('대기 중인 마이그레이션 수', detectionResult.pendingMigrations.length);

    if (detectionResult.pendingMigrations.length > 0) {
      logWarning('대기 중인 마이그레이션이 있습니다:');
      detectionResult.pendingMigrations.forEach((m, index) => {
        console.log(`  ${index + 1}. ${colors.yellow}${m.migration.version}${colors.reset} - ${m.migration.name}`);
        console.log(`     ${colors.gray}${m.migration.description}${colors.reset}`);
      });
      logWarning('서버를 시작하면 자동으로 마이그레이션이 실행됩니다.');
    } else {
      logSuccess('모든 마이그레이션이 적용되었습니다.');
    }

    // 6. 주요 테이블 존재 확인
    logSection('주요 테이블 확인');
    
    const requiredTables = [
      'memory_item',
      'memory_embedding',
      'core_memory',
      'knowledge_vault'
    ];

    requiredTables.forEach(tableName => {
      const exists = tableExists(db, tableName);
      const status = exists ? '✅ 존재' : '❌ 없음';
      logInfo(tableName, status);
    });

    // 7. 요약
    logSection('요약');
    
    if (detectionResult.pendingMigrations.length === 0) {
      logSuccess('데이터베이스가 최신 상태입니다.');
      logInfo('현재 스키마 버전', currentVersion || '1.0');
    } else {
      logWarning('데이터베이스에 적용되지 않은 마이그레이션이 있습니다.');
      logInfo('대기 중인 마이그레이션', `${detectionResult.pendingMigrations.length}개`);
    }

  } catch (error) {
    logError(`마이그레이션 상태 확인 중 오류 발생: ${error}`);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    db.close();
  }
}

// 스크립트 실행
checkMigrationStatus().catch(error => {
  logError(`스크립트 실행 실패: ${error}`);
  if (error instanceof Error) {
    console.error(error.stack);
  }
  process.exit(1);
});

