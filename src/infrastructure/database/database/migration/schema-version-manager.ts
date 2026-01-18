/**
 * 스키마 버전 관리자
 * 
 * memento_schema_version 테이블을 사용하여 스키마 버전을 추적하고 관리합니다.
 */

import type Database from 'better-sqlite3';
import type { SchemaVersion } from './types.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { PIIMasker } from '../../../../shared/utils/pii-masker.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * 스키마 버전 관리자
 */
export class SchemaVersionManager {
  constructor(private db: Database.Database) {
    this.ensureVersionTable();
  }

  /**
   * 스키마 버전 테이블 생성 (없는 경우)
   */
  private ensureVersionTable(): void {
    try {
      DatabaseUtils.run(this.db, `
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 스키마 버전 테이블 생성 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw error;
    }
  }

  /**
   * 현재 스키마 버전 조회
   */
  async getCurrentVersion(): Promise<string | null> {
    try {
      const result = DatabaseUtils.get(this.db, `
        SELECT version 
        FROM memento_schema_version 
        ORDER BY applied_at DESC 
        LIMIT 1
      `);

      return result?.version || null;
    } catch (error) {
      // 테이블이 없는 경우 null 반환
      return null;
    }
  }

  /**
   * 모든 적용된 버전 목록 조회
   */
  async getAppliedVersions(): Promise<string[]> {
    try {
      const results = DatabaseUtils.all(this.db, `
        SELECT version 
        FROM memento_schema_version 
        ORDER BY applied_at ASC
      `);

      return results.map((r: any) => r.version);
    } catch (error) {
      return [];
    }
  }

  /**
   * 특정 버전이 적용되었는지 확인
   */
  async isVersionApplied(version: string): Promise<boolean> {
    try {
      const result = DatabaseUtils.get(this.db, `
        SELECT version 
        FROM memento_schema_version 
        WHERE version = ?
      `, [version]);

      return !!result;
    } catch (error) {
      return false;
    }
  }

  /**
   * 스키마 버전 기록
   */
  async recordVersion(version: SchemaVersion): Promise<void> {
    try {
      DatabaseUtils.run(this.db, `
        INSERT INTO memento_schema_version (version, migration_name, checksum, applied_by, description)
        VALUES (?, ?, ?, ?, ?)
      `, [
        version.version,
        version.migrationName,
        version.checksum || null,
        version.appliedBy || 'system',
        version.description || null
      ]);
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 스키마 버전 기록 실패', {
        version: version.version,
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw error;
    }
  }

  /**
   * 스키마 버전 삭제 (롤백 시 사용)
   */
  async removeVersion(version: string): Promise<void> {
    try {
      DatabaseUtils.run(this.db, `
        DELETE FROM memento_schema_version 
        WHERE version = ?
      `, [version]);
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 스키마 버전 삭제 실패', {
        version,
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw error;
    }
  }

  /**
   * 모든 스키마 버전 정보 조회
   */
  async getAllVersions(): Promise<SchemaVersion[]> {
    try {
      const results = DatabaseUtils.all(this.db, `
        SELECT version, applied_at, migration_name, checksum, applied_by
        FROM memento_schema_version 
        ORDER BY applied_at ASC
      `);

      return results.map((r: any) => ({
        version: r.version,
        appliedAt: new Date(r.applied_at),
        migrationName: r.migration_name,
        checksum: r.checksum || undefined,
        appliedBy: r.applied_by || 'system'
      }));
    } catch (error) {
      return [];
    }
  }
}

