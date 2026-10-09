import type Database from 'better-sqlite3';
import { log } from './init-log.js';
import { MigrationDetector } from './migration/migration-detector.js';
import { MigrationRunner } from './migration/migration-runner.js';

export async function migrateExistingDatabaseIfNeeded(db: Database.Database): Promise<void> {
  try {
    log('[MIG] 기존 데이터베이스 감지 - 마이그레이션 먼저 실행');
    const detector = new MigrationDetector();
    const detectionResult = await detector.detectPendingMigrations(db);

    if (detectionResult.pendingMigrations.length > 0) {
      log(`[PKG] 실행해야 할 마이그레이션 발견: ${detectionResult.pendingMigrations.length}개`);

      await runPendingMigrationsOrThrow(
        db,
        detectionResult.pendingMigrations.map(d => d.migration),
        (failCount, detail) =>
          `기존 DB 마이그레이션 실패 (${failCount}건). \`npm run db:migrate -w @memento/core\`로 점검하세요. ${detail}`
      );
    } else {
      log('[OK] 실행해야 할 마이그레이션이 없습니다.');
    }
  } catch (migrationError) {
    log('[ERR] 기존 데이터베이스 마이그레이션 단계에서 예외가 발생했습니다.', migrationError);
    throw migrationError;
  }
}

/**
 * 대기 마이그레이션을 백업·자동 롤백·검증과 함께 실행하고 결과를 로그한다.
 * 실패가 하나라도 있으면 failureMessage 로 만든 에러를 던진다.
 */
export async function runPendingMigrationsOrThrow(
  db: Database.Database,
  migrations: Parameters<MigrationRunner['runMigrations']>[0],
  failureMessage: (failCount: number, detail: string) => string
): Promise<void> {
  const runner = new MigrationRunner(db);
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
    throw new Error(failureMessage(failCount, detail));
  }
}
