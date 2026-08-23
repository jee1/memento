/**
 * 마이그레이션 실행 엔진
 * 
 * 마이그레이션을 안전하게 실행하고, 실패 시 롤백을 수행합니다.
 */

import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { dirname, join } from 'node:path';
import { logger } from '../../../../shared/utils/logger.js';
import { PIIMasker } from '../../../../shared/utils/pii-masker.js';
import { BackupManager } from './backup-manager.js';
import { MigrationLogger } from './migration-logger.js';
import { SchemaVersionManager } from './schema-version-manager.js';
import type { Migration,MigrationOptions,MigrationResult } from './types.js';

/**
 * 마이그레이션 실행기
 */
export class MigrationRunner {
  private backupManager: BackupManager;
  private versionManager: SchemaVersionManager;
  private logger: MigrationLogger;

  constructor(private db: Database.Database, logger?: MigrationLogger) {
    const dbName = (this.db as Database.Database & { name?: string }).name;
    const backupsDir = dbName && dbName !== ':memory:'
      ? join(dirname(dbName), 'backups')
      : undefined;
    this.backupManager = new BackupManager(backupsDir);
    this.versionManager = new SchemaVersionManager(db);
    this.logger = logger || new MigrationLogger();
  }

  /**
   * 마이그레이션 실행
   */
  async runMigration(
    migration: Migration,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const {
      createBackup = true,
      autoRollback = true,
      validate = true
    } = options;

    const result: MigrationResult = {
      version: migration.version,
      name: migration.name,
      success: false,
      startTime: new Date()
    };

    let backupPath: string | null = null;

    // 로그 파일 초기화
    this.logger.initializeLogFile(migration.version);

    try {
      const maskedMigrationName = PIIMasker.mask(migration.name).masked;
      this.logger.info(`마이그레이션 시작: ${maskedMigrationName} (v${migration.version})`);
      logger.info(`🚀 마이그레이션 시작: ${maskedMigrationName} (v${migration.version})`);

      // 1. 마이그레이션 전 검증
      if (validate) {
        this.logger.info('마이그레이션 전 검증 시작');
        logger.info('🔍 마이그레이션 전 검증 중...');
        await migration.validateBefore(this.db);
        this.logger.info('마이그레이션 전 검증 완료');
        logger.info('✅ 마이그레이션 전 검증 완료');
      }

      // 2. 백업 생성
      if (createBackup) {
        this.logger.info('백업 생성 시작');
        logger.info('💾 백업 생성 중...');
        const backup = await this.backupManager.createBackup(this.db, migration.version);
        backupPath = backup.backupPath;
        const maskedBackupPath = PIIMasker.mask(backupPath).masked;
        const maskedBackupData = PIIMasker.maskObject({ size: backup.size });
        this.logger.info(`백업 생성 완료: ${maskedBackupPath}`, maskedBackupData);
        logger.info(`✅ 백업 생성 완료: ${maskedBackupPath}`);
        try {
          const cleanup = await this.backupManager.cleanupBackups({
            mode: 'apply',
            includeInterrupted: false,
          });
          if (!cleanup.ok) {
            logger.warn('백업 보존 정리 미완료', {
              failedCount: cleanup.failedCount,
              skippedCount: cleanup.skippedCount,
              artifacts: cleanup.artifacts.filter(item => item.status !== 'deleted'),
            });
          }
        } catch (cleanupError) {
          const maskedCleanupError = cleanupError instanceof Error
            ? PIIMasker.maskError(cleanupError)
            : { message: String(cleanupError), name: 'Error' };
          logger.warn('백업 보존 정리 실패', {
            error: maskedCleanupError.message,
            errorName: maskedCleanupError.name,
          });
        }
      }

      // 3. 트랜잭션 시작
      this.db.exec('BEGIN TRANSACTION');

      try {
        // 4. 마이그레이션 실행
        this.logger.info('마이그레이션 실행 시작');
        logger.info('📝 마이그레이션 실행 중...');
        await migration.up(this.db);
        this.logger.info('마이그레이션 실행 완료');
        logger.info('✅ 마이그레이션 실행 완료');

        // 5. 마이그레이션 후 검증
        if (validate) {
          const maskedValidationStartMsg = PIIMasker.mask('마이그레이션 후 검증 시작').masked;
          this.logger.info(maskedValidationStartMsg);
          logger.info('🔍 마이그레이션 후 검증 중...');
          await migration.validateAfter(this.db);
          const maskedValidationCompleteMsg = PIIMasker.mask('마이그레이션 후 검증 완료').masked;
          this.logger.info(maskedValidationCompleteMsg);
          logger.info('✅ 마이그레이션 후 검증 완료');
        }

        // 6. 스키마 버전 기록
        const checksum = this.calculateChecksum(migration);
        const maskedVersionStartMsg = PIIMasker.mask('스키마 버전 기록 시작').masked;
        this.logger.info(maskedVersionStartMsg);
        await this.versionManager.recordVersion({
          version: migration.version,
          appliedAt: new Date(),
          migrationName: migration.name,
          checksum,
          appliedBy: 'system',
          description: migration.description
        });
        const maskedVersionCompleteMsg = PIIMasker.mask('스키마 버전 기록 완료').masked;
        this.logger.info(maskedVersionCompleteMsg);

        // 7. 트랜잭션 커밋
        this.db.exec('COMMIT');
        this.logger.info('트랜잭션 커밋 완료');
        logger.info('✅ 트랜잭션 커밋 완료');

        result.success = true;
        result.endTime = new Date();
        this.logger.logMigrationResult(result);
        logger.info(`🎉 마이그레이션 성공: ${migration.name} (v${migration.version})`);

        return result;
      } catch (migrationError) {
        // 마이그레이션 실패 시 롤백
        const maskedMigrationError = migrationError instanceof Error ? PIIMasker.maskError(migrationError) : { message: String(migrationError), name: 'Error' };
        this.logger.error('마이그레이션 실행 실패', maskedMigrationError);
        logger.error('❌ 마이그레이션 실행 실패', { error: maskedMigrationError.message, errorName: maskedMigrationError.name });
        this.db.exec('ROLLBACK');
        this.logger.info('트랜잭션 롤백 완료');
        logger.info('↩️  트랜잭션 롤백 완료');

        result.error = migrationError instanceof Error 
          ? migrationError.message 
          : String(migrationError);

        // 자동 롤백 시도
        if (autoRollback && backupPath) {
          try {
            this.logger.info('자동 롤백 시도 시작');
            logger.info('🔄 자동 롤백 시도 중...');
            await this.rollbackMigration(migration, backupPath);
            result.rollbackSuccess = true;
            this.logger.info('자동 롤백 성공');
            logger.info('✅ 자동 롤백 성공');
          } catch (rollbackError) {
            result.rollbackSuccess = false;
            const maskedRollbackError = rollbackError instanceof Error ? PIIMasker.maskError(rollbackError) : { message: String(rollbackError), name: 'Error' };
            this.logger.error('자동 롤백 실패', maskedRollbackError);
            logger.error('❌ 자동 롤백 실패', { error: maskedRollbackError.message, errorName: maskedRollbackError.name });
            logger.error('⚠️  수동 복구가 필요합니다. 백업 파일', { backupPath });
          }
        }

        result.endTime = new Date();
        this.logger.logMigrationResult(result);
        return result;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.endTime = new Date();
      return result;
    }
  }

  /**
   * 마이그레이션 롤백
   */
  async rollbackMigration(migration: Migration, _backupPath: string): Promise<void> {
    try {
      logger.info(`↩️  마이그레이션 롤백 시작: ${migration.name} (v${migration.version})`);

      // 1. 롤백 실행
      await migration.down(this.db);

      // 2. 스키마 버전 삭제
      await this.versionManager.removeVersion(migration.version);

      // 3. 백업 복원 (필요한 경우)
      // 주의: down()이 완전히 롤백하지 못한 경우에만 백업 복원
      // 일반적으로는 down()만으로 충분하므로 백업 복원은 선택적

      logger.info(`✅ 마이그레이션 롤백 완료: ${migration.name} (v${migration.version})`);
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 마이그레이션 롤백 실패', { error: maskedError.message, errorName: maskedError.name });
      throw error;
    }
  }

  /**
   * 여러 마이그레이션 순차 실행
   */
  async runMigrations(
    migrations: Migration[],
    options: MigrationOptions = {}
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const migration of migrations) {
      const result = await this.runMigration(migration, options);
      results.push(result);

      // 실패한 마이그레이션이 있고 autoRollback이 true인 경우 중단
      if (!result.success && options.autoRollback) {
        logger.error(`❌ 마이그레이션 실패로 인해 중단: ${migration.name} (v${migration.version})`);
        break;
      }
    }

    return results;
  }

  /**
   * 마이그레이션 체크섬 계산
   */
  private calculateChecksum(migration: Migration): string {
    // 마이그레이션의 버전, 이름, 설명을 기반으로 체크섬 생성
    const content = `${migration.version}:${migration.name}:${migration.description || ''}`;
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 백업 매니저 반환
   */
  getBackupManager(): BackupManager {
    return this.backupManager;
  }

  /**
   * 버전 매니저 반환
   */
  getVersionManager(): SchemaVersionManager {
    return this.versionManager;
  }
}
