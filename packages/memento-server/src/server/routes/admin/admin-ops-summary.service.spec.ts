import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildOpsSummary } from './admin-ops-summary.service.js';
import type { ServerServices } from '../../bootstrap.js';

describe('buildOpsSummary owner scope (#1567)', () => {
  it('scopes memory.search.failed events to owner_id', async () => {
    const getEvents = vi.fn(({ owner_id }: { owner_id?: string }) => {
      if (owner_id === 'owner-a') {
        return {
          events: [{ created_at: '2026-10-31T00:00:00.000Z', request_id: 'req-a' }],
          total: 2,
        };
      }
      return { events: [], total: 0 };
    });

    const serverServices = {
      telemetryService: {
        getSearchQuality: () => ({
          search_count: 0,
          avg_latency_ms: null,
          p95_latency_ms: null,
          empty_retrieval_rate: null,
        }),
        getSystemMetrics: () => ({
          tools: {
            recall: { request_count: 0, error_count: 0 },
            remember: { request_count: 0, error_count: 0 },
            feedback: { request_count: 0, error_count: 0 },
          },
        }),
        getEvents,
      },
    } as unknown as ServerServices;

    const db = new Database(':memory:');
    const forA = await buildOpsSummary(db, serverServices, '24h', 'owner-a', Date.parse('2026-10-31T12:00:00.000Z'));
    const forB = await buildOpsSummary(db, serverServices, '24h', 'owner-b', Date.parse('2026-10-31T12:00:00.000Z'));

    expect(forA.questions.search_health.search_failed_events).toBe(2);
    expect(forB.questions.search_health.search_failed_events).toBe(0);
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: 'owner-a', event_type: 'memory.search.failed' }),
    );
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: 'owner-b', event_type: 'memory.search.failed' }),
    );
    db.close();
  });
});
