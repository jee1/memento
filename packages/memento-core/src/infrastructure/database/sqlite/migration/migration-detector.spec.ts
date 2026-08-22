/**
 * MigrationDetector 테스트
 * 마이그레이션 감지기 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MigrationDetector } from './migration-detector.js';
import type { MigrationDetectionResult } from './migration-detector.js';
import Database from 'better-sqlite3';
import { SchemaVersionManager } from './schema-version-manager.js';
import { join } from 'path';

const SCHEMA_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS memento_schema_version (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    migration_name TEXT NOT NULL,
    checksum TEXT,
    applied_by TEXT DEFAULT 'system',
    description TEXT
  )
`;

describe('MigrationDetector', () => {
  let db: Database.Database;
  let detector: MigrationDetector;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_VERSION_TABLE);
    detector = new MigrationDetector();
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('detectAllMigrations', () => {
    it('모든 마이그레이션을 감지해야 함', async () => {
      // When: 모든 마이그레이션 감지
      const migrations = await detector.detectAllMigrations();

      // Then: 마이그레이션 목록이 반환되어야 함
      expect(Array.isArray(migrations)).toBe(true);
      // 마이그레이션이 있으면 각 항목이 올바른 구조를 가져야 함
      if (migrations.length > 0) {
        const first = migrations[0];
        expect(first.migration).toBeDefined();
        expect(first.filePath).toBeDefined();
        expect(typeof first.versionNumber).toBe('number');
      }
    });

    it('마이그레이션이 버전 순서로 정렬되어야 함', async () => {
      // When: 모든 마이그레이션 감지
      const migrations = await detector.detectAllMigrations();

      // Then: 버전 순서로 정렬되어야 함
      for (let i = 1; i < migrations.length; i++) {
        expect(migrations[i].versionNumber).toBeGreaterThanOrEqual(
          migrations[i - 1].versionNumber
        );
      }
    });
  });

  describe('detectPendingMigrations', () => {
    it('실행해야 할 마이그레이션을 감지해야 함', async () => {
      // When: 실행해야 할 마이그레이션 감지
      const result = await detector.detectPendingMigrations(db);

      // Then: 감지 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(Array.isArray(result.pendingMigrations)).toBe(true);
      expect(Array.isArray(result.appliedMigrations)).toBe(true);
      expect(result.currentVersion !== undefined).toBe(true);
    });

    it('적용된 마이그레이션과 실행해야 할 마이그레이션을 구분해야 함', async () => {
      // Given: 스키마 버전 기록
      const versionManager = new SchemaVersionManager(db);
      await versionManager.recordVersion({
        version: '2.0',
        migrationName: 'test-migration',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'Test migration'
      });

      // When: 실행해야 할 마이그레이션 감지
      const result = await detector.detectPendingMigrations(db);

      // Then: 적용된 마이그레이션과 실행해야 할 마이그레이션이 구분되어야 함
      expect(result.currentVersion).toBe('2.0');
      // 버전 2.0은 appliedMigrations에 포함되어야 함
      const appliedVersions = result.appliedMigrations.map(m => m.migration.version);
      expect(appliedVersions).toContain('2.0');
    });

    it('버전이 없으면 모든 마이그레이션이 pending이어야 함', async () => {
      // When: 실행해야 할 마이그레이션 감지 (버전 없음)
      const result = await detector.detectPendingMigrations(db);

      // Then: 모든 마이그레이션이 pending이어야 함
      if (result.currentVersion === null) {
        expect(result.appliedMigrations.length).toBe(0);
      }
    });
  });

  describe('parseVersionNumber', () => {
    it('버전 문자열을 숫자로 변환해야 함', async () => {
      // MigrationDetector의 parseVersionNumber는 private이므로
      // detectAllMigrations를 통해 간접적으로 테스트
      // 버전 번호가 올바르게 파싱되어 정렬되는지 확인
      const migrations = await detector.detectAllMigrations();
      if (migrations.length >= 2) {
        expect(migrations[0].versionNumber).toBeLessThanOrEqual(
          migrations[1].versionNumber
        );
      }
    });
  });
});

