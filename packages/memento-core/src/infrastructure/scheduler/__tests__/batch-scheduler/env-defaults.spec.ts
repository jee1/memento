import { describe, it, expect } from 'vitest';
import { BatchScheduler } from '../../batch-scheduler.js';

// DB 없이 실행 가능한 env var 기본값 테스트 (better-sqlite3 의존 없음)
describe('BatchScheduler 기본값 및 env var', () => {
  it('기본 healthCheckInterval이 300,000ms(5분)이어야 함', () => {
    const s = new BatchScheduler();
    expect(s.getStatus().config.healthCheckInterval).toBe(300_000);
  });

  it('BATCH_HEALTH_CHECK_INTERVAL_MS 환경 변수로 healthCheckInterval을 재정의할 수 있어야 함', () => {
    const original = process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
    process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = '60000';
    try {
      expect(new BatchScheduler().getStatus().config.healthCheckInterval).toBe(60_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
      else process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = original;
    }
  });

  it('BATCH_HEALTH_CHECK_INTERVAL_MS가 유효하지 않으면 기본값 300,000을 사용해야 함', () => {
    const original = process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
    process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = '-1';
    try {
      expect(new BatchScheduler().getStatus().config.healthCheckInterval).toBe(300_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
      else process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = original;
    }
  });

  it('기본 monitoringInterval이 300,000ms(5분)이어야 함', () => {
    const s = new BatchScheduler();
    expect(s.getStatus().config.monitoringInterval).toBe(300_000);
  });

  it('BATCH_MONITORING_INTERVAL_MS 환경 변수로 monitoringInterval을 재정의할 수 있어야 함', () => {
    const original = process.env.BATCH_MONITORING_INTERVAL_MS;
    process.env.BATCH_MONITORING_INTERVAL_MS = '60000';
    try {
      expect(new BatchScheduler().getStatus().config.monitoringInterval).toBe(60_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_MONITORING_INTERVAL_MS;
      else process.env.BATCH_MONITORING_INTERVAL_MS = original;
    }
  });

  it('BATCH_MONITORING_INTERVAL_MS가 유효하지 않으면 기본값 300,000을 사용해야 함', () => {
    const original = process.env.BATCH_MONITORING_INTERVAL_MS;
    process.env.BATCH_MONITORING_INTERVAL_MS = 'abc';
    try {
      expect(new BatchScheduler().getStatus().config.monitoringInterval).toBe(300_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_MONITORING_INTERVAL_MS;
      else process.env.BATCH_MONITORING_INTERVAL_MS = original;
    }
  });

  it('healthCheckInterval이 너무 짧으면 validateConfig가 에러를 던져야 함', () => {
    expect(() => {
      new BatchScheduler({
        healthCheckInterval: 5000 // 10초 미만
      });
    }).toThrow('healthCheckInterval must be at least 10 seconds');
  });
});
