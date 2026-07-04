import type Database from 'better-sqlite3';
import fs, { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { populateVecTables } from './init-legacy-schema.js';
import { log } from './init-log.js';
import { recordBundledSchemaSqlMigrationBaseline } from './init-migration-baseline.js';
import { MigrationDetector } from './migration/migration-detector.js';
import { MigrationRunner } from './migration/migration-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function bootstrapNewDatabaseSchema(db: Database.Database): Promise<void> {
  log('[INFO] 새 데이터베이스 감지 - 초기화 전략 결정 중...');

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
        '[INFO] 기본 테이블(memory_item) 없음 — 대기 중인 증분 마이그레이션은 건너뛰고 schema.sql로 초기화합니다'
      );
    }

    if (hasPendingMigrations) {
      log(`[PKG] 마이그레이션 발견: ${detectionResult.pendingMigrations.length}개 - 마이그레이션 우선 실행`);

      const runner = new MigrationRunner(db);
      const migrations = detectionResult.pendingMigrations.map(d => d.migration);
      const results = await runner.runMigrations(migrations, {
        createBackup: true,
        autoRollback: true,
        validate: true
      });

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      log(`[OK] 마이그레이션 완료: 성공 ${successCount}개, 실패 ${failCount}개`);

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
        populateVecTables(db, []);

        try {
          const zeroVersionCount = db.prepare(`
              SELECT COUNT(*) as count FROM core_memory WHERE version = 0
            `).get() as { count: number } | undefined;

          if (zeroVersionCount && zeroVersionCount.count > 0) {
            const errorMessage = `마이그레이션 검증 실패: core_memory 테이블에 version=0인 행이 ${zeroVersionCount.count}개 있습니다. 마이그레이션 010이 완료되지 않았을 수 있습니다.`;
            log(`[ERR] ${errorMessage}`);
            throw new Error(errorMessage);
          }

          log('[OK] core_memory 버전 마이그레이션 검증 완료 (version=0인 행 없음)');
        } catch (validationError) {
          if (validationError instanceof Error && validationError.message.includes('no such table')) {
            log('[WARN]  core_memory 테이블이 없습니다. 마이그레이션 002가 아직 실행되지 않았을 수 있습니다.');
          } else {
            throw validationError;
          }
        }
      }
    }
  } catch (migrationError) {
    log('[ERR] 신규 DB: 마이그레이션 감지/실행 중 오류 발생:', migrationError);
    throw migrationError;
  }

  if (!hasPendingMigrations) {
    log('[INFO] schema.sql 실행 (최신 스키마 적용)');
    let schemaPath = join(__dirname, '..', '..', '..', 'database', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      const fallback = join(__dirname, 'schema.sql');
      if (fs.existsSync(fallback)) schemaPath = fallback;
    }
    const schema = readFileSync(schemaPath, 'utf-8');

    db.exec(schema);

    populateVecTables(db, []);

    await recordBundledSchemaSqlMigrationBaseline(db);
  }
}
