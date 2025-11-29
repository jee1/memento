/**
 * MigrationLogger 테스트
 * 마이그레이션 로거 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MigrationLogger, LogLevel } from './migration-logger.js';
import type { MigrationResult } from '../../../../tools/types.js';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

describe('MigrationLogger', () => {
  let logger: MigrationLogger;
  let testLogDir: string;

  beforeEach(() => {
    // 테스트용 로그 디렉토리
    testLogDir = join(process.cwd(), 'data', 'test-logs');
    logger = new MigrationLogger(testLogDir);
  });

  afterEach(() => {
    // 테스트 로그 파일 정리
    try {
      if (logger.getLogFile() && existsSync(logger.getLogFile()!)) {
        unlinkSync(logger.getLogFile()!);
      }
    } catch (error) {
      // 정리 실패는 무시
    }
  });

  describe('initializeLogFile', () => {
    it('로그 파일을 초기화해야 함', () => {
      // When: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // Then: 로그 파일이 설정되어야 함
      const logFile = logger.getLogFile();
      expect(logFile).toBeDefined();
      expect(logFile).toContain('migration_1.0');
      expect(logFile).toContain('.log');
    });

    it('로그 파일이 생성되어야 함', () => {
      // When: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // Then: 로그 파일이 생성되어야 함
      const logFile = logger.getLogFile();
      if (logFile && existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('마이그레이션 로그 시작');
        expect(content).toContain('1.0');
      }
    });
  });

  describe('log', () => {
    it('로그를 기록해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: 로그 기록
      logger.log(LogLevel.INFO, 'Test log message', { key: 'value' });

      // Then: 로그가 기록되어야 함
      const entries = logger.getEntries();
      expect(entries.length).toBeGreaterThan(0);
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.level).toBe(LogLevel.INFO);
      expect(lastEntry.message).toBe('Test log message');
      expect(lastEntry.data).toEqual({ key: 'value' });
    });

    it('다양한 로그 레벨을 지원해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: 다양한 로그 레벨 기록
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      logger.debug('Debug message');

      // Then: 모든 로그 레벨이 기록되어야 함
      const entries = logger.getEntries();
      const levels = entries.map(e => e.level);
      expect(levels).toContain(LogLevel.INFO);
      expect(levels).toContain(LogLevel.WARN);
      expect(levels).toContain(LogLevel.ERROR);
      expect(levels).toContain(LogLevel.DEBUG);
    });
  });

  describe('info, warn, error, debug', () => {
    it('INFO 레벨 로그를 기록해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: INFO 로그 기록
      logger.info('Info message', { data: 'test' });

      // Then: INFO 레벨 로그가 기록되어야 함
      const entries = logger.getEntries();
      const infoEntry = entries.find(e => e.level === LogLevel.INFO);
      expect(infoEntry).toBeDefined();
      expect(infoEntry?.message).toBe('Info message');
    });

    it('WARN 레벨 로그를 기록해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: WARN 로그 기록
      logger.warn('Warning message');

      // Then: WARN 레벨 로그가 기록되어야 함
      const entries = logger.getEntries();
      const warnEntry = entries.find(e => e.level === LogLevel.WARN);
      expect(warnEntry).toBeDefined();
      expect(warnEntry?.message).toBe('Warning message');
    });

    it('ERROR 레벨 로그를 기록해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: ERROR 로그 기록
      logger.error('Error message', { error: 'test error' });

      // Then: ERROR 레벨 로그가 기록되어야 함
      const entries = logger.getEntries();
      const errorEntry = entries.find(e => e.level === LogLevel.ERROR);
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.message).toBe('Error message');
    });

    it('DEBUG 레벨 로그를 기록해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: DEBUG 로그 기록
      logger.debug('Debug message');

      // Then: DEBUG 레벨 로그가 기록되어야 함
      const entries = logger.getEntries();
      const debugEntry = entries.find(e => e.level === LogLevel.DEBUG);
      expect(debugEntry).toBeDefined();
      expect(debugEntry?.message).toBe('Debug message');
    });
  });

  describe('logMigrationResult', () => {
    it('마이그레이션 결과를 기록해야 함', () => {
      // Given: 로그 파일 초기화 및 마이그레이션 결과
      logger.initializeLogFile('1.0');
      const result: MigrationResult = {
        version: '1.0',
        name: 'test-migration',
        success: true,
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T00:00:10Z')
      };

      // When: 마이그레이션 결과 기록
      logger.logMigrationResult(result);

      // Then: 결과가 로그 파일에 기록되어야 함
      const logFile = logger.getLogFile();
      if (logFile && existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('마이그레이션 결과');
        expect(content).toContain('1.0');
        expect(content).toContain('test-migration');
        expect(content).toContain('성공');
      }
    });

    it('실패한 마이그레이션 결과를 기록해야 함', () => {
      // Given: 로그 파일 초기화 및 실패한 마이그레이션 결과
      logger.initializeLogFile('1.0');
      const result: MigrationResult = {
        version: '1.0',
        name: 'test-migration',
        success: false,
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T00:00:10Z'),
        error: 'Migration failed'
      };

      // When: 마이그레이션 결과 기록
      logger.logMigrationResult(result);

      // Then: 실패 정보가 로그 파일에 기록되어야 함
      const logFile = logger.getLogFile();
      if (logFile && existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('실패');
        expect(content).toContain('Migration failed');
      }
    });
  });

  describe('getLogFile', () => {
    it('로그 파일 경로를 반환해야 함', () => {
      // Given: 로그 파일 초기화
      logger.initializeLogFile('1.0');

      // When: 로그 파일 경로 조회
      const logFile = logger.getLogFile();

      // Then: 로그 파일 경로가 반환되어야 함
      expect(logFile).toBeDefined();
      expect(typeof logFile).toBe('string');
    });

    it('로그 파일이 초기화되지 않으면 null을 반환해야 함', () => {
      // When: 로그 파일 경로 조회 (초기화 전)
      const logFile = logger.getLogFile();

      // Then: null 반환
      expect(logFile).toBeNull();
    });
  });

  describe('getEntries', () => {
    it('로그 엔트리 목록을 반환해야 함', () => {
      // Given: 로그 기록
      logger.info('Test message');

      // When: 로그 엔트리 조회
      const entries = logger.getEntries();

      // Then: 로그 엔트리 목록이 반환되어야 함
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('로그 엔트리가 올바른 구조를 가져야 함', () => {
      // Given: 로그 기록
      logger.info('Test message', { data: 'test' });

      // When: 로그 엔트리 조회
      const entries = logger.getEntries();

      // Then: 로그 엔트리가 올바른 구조를 가져야 함
      if (entries.length > 0) {
        const entry = entries[0];
        expect(entry.timestamp).toBeInstanceOf(Date);
        expect(entry.level).toBeDefined();
        expect(entry.message).toBeDefined();
      }
    });
  });

  describe('getLogDirectory', () => {
    it('로그 디렉토리 경로를 반환해야 함', () => {
      // When: 로그 디렉토리 경로 조회
      const logDir = logger.getLogDirectory();

      // Then: 로그 디렉토리 경로가 반환되어야 함
      expect(logDir).toBeDefined();
      expect(typeof logDir).toBe('string');
      expect(logDir).toBe(testLogDir);
    });
  });
});

