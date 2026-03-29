import { describe, it, expect, vi, afterEach } from 'vitest';
import { TelemetryService } from './telemetry-service.js';
import type { TelemetryRepository } from '../repositories/telemetry-repository.js';

describe('TelemetryService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('record는 호출 시 동기적으로 throw 하지 않는다 (FR-011)', () => {
    const repo = {
      insertEventSync: vi.fn()
    } as unknown as TelemetryRepository;
    const svc = new TelemetryService(repo);
    expect(() =>
      svc.record({ eventType: 'memory.search.requested', outcome: 'success' })
    ).not.toThrow();
  });

  it('repository insert 실패 시에도 record 호출부는 throw 하지 않고 setImmediate에서 흡수된다', async () => {
    const repo = {
      insertEventSync: vi.fn(() => {
        throw new Error('telemetry db fail');
      })
    } as unknown as TelemetryRepository;
    const svc = new TelemetryService(repo);
    svc.record({ eventType: 'memory.feedback.positive', outcome: 'success', latencyMs: 1 });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(repo.insertEventSync).toHaveBeenCalled();
  });

  it('hasPriorWriteWithContentHash는 repository에 위임한다', () => {
    const repo = {
      hasPriorWriteCompletedWithContentHash: vi.fn().mockReturnValue(true)
    } as unknown as TelemetryRepository;
    const svc = new TelemetryService(repo);
    expect(svc.hasPriorWriteWithContentHash('o', 'h', '2020-01-01')).toBe(true);
    expect(repo.hasPriorWriteCompletedWithContentHash).toHaveBeenCalledWith('o', 'h', '2020-01-01');
  });

  it('getEvents는 extra_data JSON이 깨져도 해당 행만 null로 두고 throw 하지 않는다', () => {
    const repo = {
      queryEvents: vi.fn().mockReturnValue({
        events: [
          {
            id: 'e1',
            event_type: 'memory.search.requested',
            request_id: 'r1',
            owner_id: null,
            latency_ms: null,
            outcome: 'success',
            error_code: null,
            extra_data: '{invalid',
            created_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        total: 1
      })
    } as unknown as TelemetryRepository;
    const svc = new TelemetryService(repo);
    const out = svc.getEvents({ limit: 10, offset: 0 });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].extra_data).toBeNull();
  });
});
