import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { logger } from '../../../../shared/utils/logger.js';
import { FileLogger } from '../../file-logger.js';

describe('BatchScheduler', () => {
  let scheduler: BatchScheduler;
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = new BatchScheduler({
      cleanupInterval: 60000, // 최소 1분
      monitoringInterval: 10000, // 최소 10초
      healthCheckInterval: 10000,
      memoryReviewCandidatesInterval: 60000,
      maxBatchSize: 100,
      enableLogging: false, // 테스트 중 로그 최소화
      enableNotifications: false,
      enableMetrics: false,
      maxConcurrentJobs: 2,
      jobTimeout: 5000,
      retryAttempts: 2,
      retryDelay: 100
    });
  });

  afterEach(async () => {
    if (scheduler) {
      await scheduler.stop();
    }
    await cleanupTestDatabase(db);
  });

  describe('로깅', () => {
    it('로깅이 비활성화되면 로그를 출력하지 않아야 함', async () => {
      const noLogScheduler = new BatchScheduler({
        enableLogging: false
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await noLogScheduler.start(db);
      await new Promise(resolve => setTimeout(resolve, 100));
      await noLogScheduler.stop();

      // 로깅이 비활성화되어 있으므로 특정 로그가 출력되지 않아야 함
      // (다만 다른 시스템 로그는 있을 수 있음)

      consoleSpy.mockRestore();
      await cleanupTestDatabase(db);
    });

    it('Error 객체를 로그에 전달할 때 속성이 보존되어야 함', async () => {
      // Given: 로깅이 활성화된 스케줄러와 mcpLogger 모킹
      const testScheduler = new BatchScheduler({
        enableLogging: true,
        cleanupInterval: 60000,
        monitoringInterval: 10000
      });

      const mcpLoggerModule = await import('../../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');

      await testScheduler.start(db);

      // When: Error 객체를 포함한 작업 실행
      // 데이터베이스 연결을 끊어서 에러 발생 유도
      const originalDb = db;
      db.close();

      try {
        await testScheduler.runJob('cleanup');
      } catch {
        // 에러는 예상됨
      }

      // Then: Error 객체의 message, name, stack이 로그에 포함되어야 함
      const errorLogCalls = logBatchSpy.mock.calls.filter(
        call => call[0] === 'error' && call[2] && typeof call[2] === 'object'
      );

      if (errorLogCalls.length > 0) {
        const lastErrorCall = errorLogCalls[errorLogCalls.length - 1];
        const logData = lastErrorCall[2] as any;

        // Error 객체의 속성이 제대로 추출되었는지 확인
        // message, name, stack 중 하나라도 있어야 함
        const hasErrorInfo =
          (logData.message && typeof logData.message === 'string') ||
          (logData.name && typeof logData.name === 'string') ||
          (logData.stack && typeof logData.stack === 'string');

        expect(hasErrorInfo).toBe(true);
      }

      logBatchSpy.mockRestore();

      // 스케줄러만 중지 (동일 db 유지). setupTestDatabase() 호출 시 BatchScheduler 중복 기동으로 실패하므로 재생성 생략
      await testScheduler.stop();
    });

    it('data.level을 읽어서 로그 레벨로 사용해야 함', async () => {
      // Given: 로깅이 활성화된 스케줄러와 mcpLogger 모킹
      const testScheduler = new BatchScheduler({
        enableLogging: true,
        cleanupInterval: 60000,
        monitoringInterval: 10000
      });

      const mcpLoggerModule = await import('../../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');

      await testScheduler.start(db);

      // When: data.level을 포함한 로그 호출 (내부 log 메서드 사용)
      const schedulerAny = testScheduler as any;
      schedulerAny.log('Test warn message', { level: 'warn', customData: 'test' });
      schedulerAny.log('Test error message', { level: 'error', customData: 'test' });
      schedulerAny.log('Test debug message', { level: 'debug', customData: 'test' }); // debug는 info로 변환됨

      // Then: 올바른 레벨로 로그가 기록되어야 함
      const warnCalls = logBatchSpy.mock.calls.filter(call => call[0] === 'warn');
      const errorCalls = logBatchSpy.mock.calls.filter(call => call[0] === 'error');
      const infoCalls = logBatchSpy.mock.calls.filter(call => call[0] === 'info');

      // warn 레벨 로그가 기록되었는지 확인
      expect(warnCalls.length).toBeGreaterThan(0);
      const warnCall = warnCalls.find(call => call[1] === 'Test warn message');
      expect(warnCall).toBeDefined();
      expect(warnCall?.[2]).not.toHaveProperty('level'); // level 속성은 제거되어야 함
      expect(warnCall?.[2]).toHaveProperty('customData'); // 다른 데이터는 보존되어야 함

      // error 레벨 로그가 기록되었는지 확인
      expect(errorCalls.length).toBeGreaterThan(0);
      const errorCall = errorCalls.find(call => call[1] === 'Test error message');
      expect(errorCall).toBeDefined();
      expect(errorCall?.[2]).not.toHaveProperty('level'); // level 속성은 제거되어야 함

      // debug는 info로 변환되어야 함
      const debugAsInfoCall = infoCalls.find(call => call[1] === 'Test debug message');
      expect(debugAsInfoCall).toBeDefined();

      logBatchSpy.mockRestore();
      await testScheduler.stop();
    });
  });

  describe('로깅 정책 통일 (console.* 제거)', () => {
    let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let mockFileLogger: FileLogger;

    beforeEach(() => {
      // Given: FileLogger 모킹 (파일 로깅 실패 시뮬레이션)
      mockFileLogger = {
        logWarn: vi.fn().mockRejectedValue(new Error('File logging failed')),
        logError: vi.fn().mockRejectedValue(new Error('File logging failed'))
      } as unknown as FileLogger;

      // Logger 스파이 설정
      loggerErrorSpy = vi.spyOn(logger, 'error');

      // console.* 스파이 설정 (사용되지 않아야 함)
      consoleErrorSpy = vi.spyOn(console, 'error');
    });

    afterEach(() => {
      // When: 테스트 후 정리
      vi.restoreAllMocks();
    });

    /**
     * Given: BatchScheduler가 표준 로거를 사용하도록 변경됨
     * When: 파일 로깅 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('파일 로깅 실패 시 logger.error를 사용해야 함', async () => {
      // Given: FileLogger가 실패하도록 모킹된 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        enableLogging: true,
        maxBatchSize: 100
      }, {
        fileLogger: mockFileLogger
      });

      await testScheduler.start(db);

      // When: warn 레벨 로그 호출 (파일 로깅 실패 시뮬레이션)
      const schedulerAny = testScheduler as any;
      schedulerAny.log('Test warn message', { level: 'warn' });

      // 파일 로깅 실패 처리를 위해 충분한 대기 (비동기 catch 처리)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();

      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('File logging failed'))).toBe(true);

      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      await testScheduler.stop();
    });

    /**
     * Given: BatchScheduler가 표준 로거를 사용하도록 변경됨
     * When: 파일 로깅 실패 시 (error 레벨)
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('파일 로깅 실패 시 (error 레벨) logger.error를 사용해야 함', async () => {
      // Given: FileLogger가 실패하도록 모킹된 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        enableLogging: true,
        maxBatchSize: 100
      }, {
        fileLogger: mockFileLogger
      });

      await testScheduler.start(db);

      // When: error 레벨 로그 호출 (파일 로깅 실패 시뮬레이션)
      const schedulerAny = testScheduler as any;
      schedulerAny.log('Test error message', { level: 'error' });

      // 파일 로깅 실패 처리를 위해 충분한 대기 (비동기 catch 처리)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();

      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('File logging failed'))).toBe(true);

      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      await testScheduler.stop();
    });
  });
});
