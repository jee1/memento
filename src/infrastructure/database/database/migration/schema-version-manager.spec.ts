/**
 * SchemaVersionManager 테스트
 * 스키마 버전 관리자 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemaVersionManager } from './schema-version-manager.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../test/helpers/test-database.js';
import type { SchemaVersion } from '../../../../tools/types.js';

describe('SchemaVersionManager', () => {
  let db: Database.Database;
  let versionManager: SchemaVersionManager;

  beforeEach(async () => {
    db = await setupTestDatabase();
    versionManager = new SchemaVersionManager(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('getCurrentVersion', () => {
    it('버전이 없으면 null을 반환해야 함', async () => {
      // When: 현재 버전 조회
      const version = await versionManager.getCurrentVersion();

      // Then: null 반환
      expect(version).toBeNull();
    });

    it('현재 버전을 반환해야 함', async () => {
      // Given: 버전 기록
      const schemaVersion: SchemaVersion = {
        version: '1.0',
        migrationName: 'test-migration',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'Test migration'
      };
      await versionManager.recordVersion(schemaVersion);

      // When: 현재 버전 조회
      const version = await versionManager.getCurrentVersion();

      // Then: 기록된 버전 반환
      expect(version).toBe('1.0');
    });

    it('가장 최근 버전을 반환해야 함', async () => {
      // Given: 여러 버전 기록
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'migration-1',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'First migration'
      });
      // SQLite의 CURRENT_TIMESTAMP는 초 단위이므로 1초 이상 대기
      await new Promise(resolve => setTimeout(resolve, 1100));
      await versionManager.recordVersion({
        version: '2.0',
        migrationName: 'migration-2',
        checksum: 'def456',
        appliedBy: 'test',
        description: 'Second migration'
      });

      // When: 현재 버전 조회
      const version = await versionManager.getCurrentVersion();

      // Then: 가장 최근 버전 반환
      expect(version).toBe('2.0');
    });
  });

  describe('getAppliedVersions', () => {
    it('적용된 버전 목록을 반환해야 함', async () => {
      // Given: 여러 버전 기록
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'migration-1',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'First migration'
      });
      await versionManager.recordVersion({
        version: '2.0',
        migrationName: 'migration-2',
        checksum: 'def456',
        appliedBy: 'test',
        description: 'Second migration'
      });

      // When: 적용된 버전 목록 조회
      const versions = await versionManager.getAppliedVersions();

      // Then: 모든 버전이 반환되어야 함
      expect(versions).toContain('1.0');
      expect(versions).toContain('2.0');
      expect(versions.length).toBe(2);
    });

    it('버전이 없으면 빈 배열을 반환해야 함', async () => {
      // When: 적용된 버전 목록 조회
      const versions = await versionManager.getAppliedVersions();

      // Then: 빈 배열 반환
      expect(versions).toEqual([]);
    });

    it('버전이 시간순으로 정렬되어야 함', async () => {
      // Given: 여러 버전 기록 (시간 차이를 두기 위해)
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'migration-1',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'First migration'
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await versionManager.recordVersion({
        version: '2.0',
        migrationName: 'migration-2',
        checksum: 'def456',
        appliedBy: 'test',
        description: 'Second migration'
      });

      // When: 적용된 버전 목록 조회
      const versions = await versionManager.getAppliedVersions();

      // Then: 시간순으로 정렬되어야 함
      expect(versions[0]).toBe('1.0');
      expect(versions[1]).toBe('2.0');
    });
  });

  describe('isVersionApplied', () => {
    it('적용된 버전은 true를 반환해야 함', async () => {
      // Given: 버전 기록
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'test-migration',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'Test migration'
      });

      // When: 버전 적용 여부 확인
      const isApplied = await versionManager.isVersionApplied('1.0');

      // Then: true 반환
      expect(isApplied).toBe(true);
    });

    it('적용되지 않은 버전은 false를 반환해야 함', async () => {
      // When: 버전 적용 여부 확인
      const isApplied = await versionManager.isVersionApplied('999.0');

      // Then: false 반환
      expect(isApplied).toBe(false);
    });
  });

  describe('recordVersion', () => {
    it('스키마 버전을 기록해야 함', async () => {
      // Given: 스키마 버전
      const schemaVersion: SchemaVersion = {
        version: '1.0',
        migrationName: 'test-migration',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'Test migration'
      };

      // When: 버전 기록
      await versionManager.recordVersion(schemaVersion);

      // Then: 버전이 기록되어야 함
      const version = await versionManager.getCurrentVersion();
      expect(version).toBe('1.0');
      const isApplied = await versionManager.isVersionApplied('1.0');
      expect(isApplied).toBe(true);
    });

    it('체크섬을 포함하여 기록해야 함', async () => {
      // Given: 체크섬이 있는 스키마 버전
      const schemaVersion: SchemaVersion = {
        version: '1.0',
        migrationName: 'test-migration',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'Test migration'
      };

      // When: 버전 기록
      await versionManager.recordVersion(schemaVersion);

      // Then: 체크섬이 기록되어야 함
      const version = await versionManager.getCurrentVersion();
      expect(version).toBe('1.0');
    });
  });

  describe('getAllVersions', () => {
    it('모든 버전 정보를 반환해야 함', async () => {
      // Given: 여러 버전 기록
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'migration-1',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'First migration'
      });
      await versionManager.recordVersion({
        version: '2.0',
        migrationName: 'migration-2',
        checksum: 'def456',
        appliedBy: 'test',
        description: 'Second migration'
      });

      // When: 모든 버전 정보 조회
      const versions = await versionManager.getAllVersions();

      // Then: 모든 버전이 반환되어야 함
      expect(versions.length).toBe(2);
      expect(versions[0].version).toBe('1.0');
      expect(versions[1].version).toBe('2.0');
    });

    it('버전 정보가 시간순으로 정렬되어야 함', async () => {
      // Given: 여러 버전 기록
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'migration-1',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'First migration'
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await versionManager.recordVersion({
        version: '2.0',
        migrationName: 'migration-2',
        checksum: 'def456',
        appliedBy: 'test',
        description: 'Second migration'
      });

      // When: 모든 버전 정보 조회
      const versions = await versionManager.getAllVersions();

      // Then: 시간순으로 정렬되어야 함
      expect(versions[0].version).toBe('1.0');
      expect(versions[1].version).toBe('2.0');
      expect(versions[0].appliedAt.getTime()).toBeLessThanOrEqual(
        versions[1].appliedAt.getTime()
      );
    });
  });

  describe('removeVersion', () => {
    it('버전을 삭제해야 함', async () => {
      // Given: 버전 기록
      await versionManager.recordVersion({
        version: '1.0',
        migrationName: 'test-migration',
        checksum: 'abc123',
        appliedBy: 'test',
        description: 'Test migration'
      });

      // When: 버전 삭제
      await versionManager.removeVersion('1.0');

      // Then: 버전이 삭제되어야 함
      const isApplied = await versionManager.isVersionApplied('1.0');
      expect(isApplied).toBe(false);
    });
  });
});

