import { describe, it, expect } from 'vitest';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';

describe('BatchScheduler', () => {
  describe('생성자 및 설정 검증', () => {
    it('유효한 설정으로 생성해야 함', () => {
      const validScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        maxBatchSize: 100,
        maxConcurrentJobs: 3,
        jobTimeout: 5000
      });

      expect(validScheduler).toBeDefined();
    });

    it('기본 설정으로 생성해야 함', () => {
      const defaultScheduler = new BatchScheduler();
      expect(defaultScheduler).toBeDefined();
    });

    it('cleanupInterval이 너무 짧으면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          cleanupInterval: 50000 // 1분 미만
        });
      }).toThrow('cleanupInterval must be at least 1 minute');
    });

    it('monitoringInterval이 너무 짧으면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          monitoringInterval: 5000 // 10초 미만
        });
      }).toThrow('monitoringInterval must be at least 10 seconds');
    });

    it.each([
      ['walCheckpointInterval', 0],
      ['walCheckpointInterval', Number.POSITIVE_INFINITY],
      ['lockMonitorInterval', -1],
      ['lockMonitorInterval', Number.NaN],
      ['reflexionCleanupInterval', 0],
      ['reflexionCleanupInterval', Number.POSITIVE_INFINITY],
      ['reflexionHealthCheckInterval', -1],
      ['reflexionHealthCheckInterval', Number.NaN],
    ] as const)('%s이 양의 유한수가 아니면 에러를 던져야 함', (key, value) => {
      expect(() => {
        new BatchScheduler({ [key]: value });
      }).toThrow(`${key} must be a positive finite number`);
    });

    it('maxBatchSize가 0이면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          maxBatchSize: 0
        });
      }).toThrow('maxBatchSize must be at least 1');
    });

    it('maxConcurrentJobs가 0이면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          maxConcurrentJobs: 0
        });
      }).toThrow('maxConcurrentJobs must be at least 1');
    });

    it('jobTimeout이 너무 짧으면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          jobTimeout: 500 // 1초 미만
        });
      }).toThrow('jobTimeout must be at least 1 second');
    });
  });
});
