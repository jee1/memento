/**
 * 마이그레이션 자동 감지 시스템
 * 
 * migrations/ 디렉토리에서 마이그레이션 스크립트를 자동으로 감지하고,
 * 현재 스키마 버전과 비교하여 실행해야 할 마이그레이션을 찾습니다.
 */

import type Database from 'better-sqlite3';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Migration } from './types.js';
import { SchemaVersionManager } from './schema-version-manager.js';
import { PIIMasker } from '../../../../shared/utils/pii-masker.js';
import { logger } from '../../../../shared/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 마이그레이션 감지 결과
 */
export interface DetectedMigration {
  /**
   * 마이그레이션 인스턴스
   */
  migration: Migration;

  /**
   * 마이그레이션 파일 경로
   */
  filePath: string;

  /**
   * 마이그레이션 버전 번호 (숫자)
   */
  versionNumber: number;
}

/**
 * 마이그레이션 감지 결과
 */
export interface MigrationDetectionResult {
  /**
   * 실행해야 할 마이그레이션 목록 (버전 순서대로 정렬됨)
   */
  pendingMigrations: DetectedMigration[];

  /**
   * 이미 실행된 마이그레이션 목록
   */
  appliedMigrations: DetectedMigration[];

  /**
   * 현재 스키마 버전
   */
  currentVersion: string | null;
}

/**
 * 마이그레이션 자동 감지기
 */
export class MigrationDetector {
  private migrationsDir: string;

  constructor(migrationsDir?: string) {
    this.migrationsDir = migrationsDir || join(__dirname, 'migrations');
  }

  /**
   * 모든 마이그레이션 파일 감지
   */
  async detectAllMigrations(): Promise<DetectedMigration[]> {
    const files = await readdir(this.migrationsDir);
    // .ts와 .js 파일 모두 지원 (개발 환경: .ts, 빌드 환경: .js)
    // .d.ts, .spec.ts, .spec.js 파일은 제외
    const migrationFiles = files.filter(file => 
      (file.endsWith('.ts') || file.endsWith('.js')) && 
      !file.endsWith('.d.ts') &&
      !file.endsWith('.spec.ts') &&
      !file.endsWith('.spec.js') &&
      !file.endsWith('.js.map') &&
      /^\d{3}-/.test(file)
    );

    const migrations: DetectedMigration[] = [];

    for (const file of migrationFiles) {
      try {
        const filePath = join(this.migrationsDir, file);
        // ESM 모듈 import: .js 파일은 확장자 포함, .ts 파일은 file:// 프로토콜 사용
        // 빌드된 환경에서는 .js 파일을 직접 import
        const importPath = file.endsWith('.js') 
          ? filePath  // .js 파일은 전체 경로 사용
          : `file://${filePath}`;  // .ts 파일은 file:// 프로토콜 사용
        const module = await import(importPath);
        
        // default export 또는 named export 찾기
        let MigrationClass: unknown = module.default;
        
        // named export에서 Migration 클래스 찾기
        if (!MigrationClass || typeof MigrationClass !== 'function') {
          const exportedKeys = Object.keys(module);
          for (const key of exportedKeys) {
            const exported = module[key];
            // 클래스인지 확인 (함수이고 prototype이 있는 경우)
            if (typeof exported === 'function' && exported.prototype) {
              // 인스턴스를 생성해서 version과 up 메서드가 있는지 확인
              try {
                const testInstance = new exported();
                if (testInstance && testInstance.version && typeof testInstance.up === 'function') {
                  MigrationClass = exported;
                  break;
                }
              } catch {
                // 인스턴스 생성 실패 시 다음으로
                continue;
              }
            }
          }
        }

        if (!MigrationClass || typeof MigrationClass !== 'function') {
          logger.warn('⚠️  마이그레이션 파일에서 유효한 마이그레이션 클래스를 찾을 수 없습니다', {
            file,
            availableExports: Object.keys(module).join(', ')
          });
          continue;
        }

        // 클래스 인스턴스 생성
        const migration = new (MigrationClass as new () => Migration)();

        if (!migration || !migration.version || !migration.up) {
          logger.warn('⚠️  마이그레이션 파일에서 유효한 마이그레이션 인스턴스를 생성할 수 없습니다', {
            file,
            version: migration?.version,
            upType: typeof migration?.up
          });
          continue;
        }

        const versionNumber = this.parseVersionNumber(migration.version);
        if (versionNumber === null) {
          logger.warn('⚠️  마이그레이션의 버전 형식이 올바르지 않습니다', {
            file,
            version: migration.version
          });
          continue;
        }

        migrations.push({
          migration,
          filePath,
          versionNumber
        });
      } catch (error) {
        const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
        logger.error('❌ 마이그레이션 파일 로드 실패', {
          file,
          error: maskedError.message,
          errorName: maskedError.name
        });
        throw new Error(`마이그레이션 로드 실패: ${file} — ${maskedError.message}`, { cause: error });
      }
    }

    // 버전 번호로 정렬
    migrations.sort((a, b) => a.versionNumber - b.versionNumber);

    return migrations;
  }

  /**
   * 실행해야 할 마이그레이션 감지
   */
  async detectPendingMigrations(db: Database.Database): Promise<MigrationDetectionResult> {
    const allMigrations = await this.detectAllMigrations();
    const versionManager = new SchemaVersionManager(db);
    const currentVersion = await versionManager.getCurrentVersion();

    const appliedVersions = currentVersion !== null
      ? await versionManager.getAppliedVersions() 
      : [];

    const pendingMigrations: DetectedMigration[] = [];
    const appliedMigrations: DetectedMigration[] = [];

    for (const detected of allMigrations) {
      if (appliedVersions.includes(detected.migration.version)) {
        appliedMigrations.push(detected);
      } else {
        pendingMigrations.push(detected);
      }
    }

    return {
      pendingMigrations,
      appliedMigrations,
      currentVersion
    };
  }

  /**
   * 버전 문자열을 숫자로 변환
   * 예: "002" -> 2, "001" -> 1
   */
  private parseVersionNumber(version: string | undefined): number | null {
    if (!version) {
      return null;
    }
    const match = version.match(/^(\d+)/);
    if (!match || !match[1]) {
      return null;
    }
    return parseInt(match[1], 10);
  }

  /**
   * 특정 버전의 마이그레이션 찾기
   */
  async findMigrationByVersion(version: string | undefined): Promise<DetectedMigration | null> {
    if (!version) {
      return null;
    }
    const allMigrations = await this.detectAllMigrations();
    return allMigrations.find(m => m.migration.version === version) || null;
  }
}

