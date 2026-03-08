/**
 * FileLogger 테스트
 * 파일 로깅 기능 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FileLogger, type LogEntry } from '../file-logger.js';

describe('FileLogger', () => {
  let logDir: string;
  let fileLogger: FileLogger;

  beforeEach(() => {
    // 테스트용 고유 임시 디렉토리 (격리로 다른 테스트/병렬 실행과 충돌 방지)
    logDir = path.join(process.cwd(), 'logs', `test-file-logger-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    fileLogger = new FileLogger({
      logDir,
      logFileName: 'test.log',
      enabled: true
    });
  });

  afterEach(() => {
    // 테스트용 로그 파일 및 디렉토리 정리
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      for (const file of files) {
        fs.unlinkSync(path.join(logDir, file));
      }
      fs.rmdirSync(logDir);
    }
  });

  describe('log', () => {
    it('should create log directory if not exists', async () => {
      // Given: 로그 디렉토리가 없는 상태
      expect(fs.existsSync(logDir)).toBe(false);

      // When: 로그 작성
      const entry: LogEntry = {
        timestamp: new Date(),
        service: 'TestService',
        level: 'info',
        message: 'Test message'
      };
      await fileLogger.log(entry);

      // Then: 로그 디렉토리 생성됨
      expect(fs.existsSync(logDir)).toBe(true);
    });

    it('should write log entry to file', async () => {
      // Given: 로그 엔트리
      const entry: LogEntry = {
        timestamp: new Date(),
        service: 'TestService',
        level: 'error',
        message: 'Test error message',
        data: { error: 'test error' }
      };

      // When: 로그 작성
      await fileLogger.log(entry);

      // Then: 파일에 로그가 기록됨
      const logFilePath = path.join(logDir, 'test.log');
      expect(fs.existsSync(logFilePath)).toBe(true);
      
      const content = fs.readFileSync(logFilePath, 'utf-8');
      expect(content).toContain('Test error message');
      expect(content).toContain('TestService');
    });

    it('should not write when disabled', async () => {
      // Given: 로깅이 비활성화된 상태
      fileLogger.setEnabled(false);
      const entry: LogEntry = {
        timestamp: new Date(),
        service: 'TestService',
        level: 'info',
        message: 'Test message'
      };

      // When: 로그 작성 시도
      await fileLogger.log(entry);

      // Then: 파일이 생성되지 않음
      const logFilePath = path.join(logDir, 'test.log');
      expect(fs.existsSync(logFilePath)).toBe(false);
    });

    it('should sanitize Error objects', async () => {
      // Given: Error 객체가 포함된 로그 엔트리
      const error = new Error('Test error');
      const entry: LogEntry = {
        timestamp: new Date(),
        service: 'TestService',
        level: 'error',
        message: 'Test error',
        data: error
      };

      // When: 로그 작성
      await fileLogger.log(entry);

      // Then: Error 객체가 정제되어 기록됨
      const logFilePath = path.join(logDir, 'test.log');
      const content = fs.readFileSync(logFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.data).toHaveProperty('message');
      expect(parsed.data).toHaveProperty('name');
      expect(parsed.data.message).toBe('Test error');
    });
  });

  describe('logWarn', () => {
    it('should log warn with context', async () => {
      // Given: 경고 정보와 컨텍스트
      const message = 'Test warn message';
      const data = { warning: 'test warning' };
      const context = {
        uptime: 2000,
        activeJobs: 1,
        queueSize: 3
      };

      // When: 경고 로그 작성
      await fileLogger.logWarn(message, data, context);

      // Then: 파일에 경고 로그가 기록됨
      const logFilePath = path.join(logDir, 'test.log');
      expect(fs.existsSync(logFilePath)).toBe(true);
      
      const content = fs.readFileSync(logFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.level).toBe('warn'); // warn 레벨로 기록되어야 함
      expect(parsed.message).toBe(message);
      expect(parsed.uptime).toBe(2000);
      expect(parsed.activeJobs).toBe(1);
      expect(parsed.queueSize).toBe(3);
    });
  });

  describe('logError', () => {
    it('should log error with context', async () => {
      // Given: 에러 정보와 컨텍스트
      const message = 'Test error message';
      const data = { error: 'test error' };
      const context = {
        uptime: 1000,
        activeJobs: 2,
        queueSize: 5
      };

      // When: 에러 로그 작성
      await fileLogger.logError(message, data, context);

      // Then: 파일에 에러 로그가 기록됨
      const logFilePath = path.join(logDir, 'test.log');
      expect(fs.existsSync(logFilePath)).toBe(true);
      
      const content = fs.readFileSync(logFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.level).toBe('error');
      expect(parsed.message).toBe(message);
      expect(parsed.uptime).toBe(1000);
      expect(parsed.activeJobs).toBe(2);
      expect(parsed.queueSize).toBe(5);
    });
  });

  describe('getLogFilePath', () => {
    it('should return correct log file path', () => {
      // Given: FileLogger 인스턴스

      // When: 로그 파일 경로 조회
      const logFilePath = fileLogger.getLogFilePath();

      // Then: 올바른 경로 반환
      expect(logFilePath).toBe(path.join(logDir, 'test.log'));
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable logging', async () => {
      // Given: 로깅이 활성화된 상태
      expect(fileLogger.getLogFilePath()).toBeDefined();

      // When: 로깅 비활성화
      fileLogger.setEnabled(false);
      const entry: LogEntry = {
        timestamp: new Date(),
        service: 'TestService',
        level: 'info',
        message: 'Test message'
      };
      await fileLogger.log(entry);

      // Then: 로그가 기록되지 않음
      const logFilePath = path.join(logDir, 'test.log');
      expect(fs.existsSync(logFilePath)).toBe(false);

      // When: 로깅 다시 활성화
      fileLogger.setEnabled(true);
      await fileLogger.log(entry);

      // Then: 로그가 기록됨
      expect(fs.existsSync(logFilePath)).toBe(true);
    });
  });
});

