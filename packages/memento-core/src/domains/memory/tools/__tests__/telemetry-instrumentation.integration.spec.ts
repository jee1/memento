/**
 * T014: 피드백 도구 + TelemetryService — 도구 성공 후 텔레메트리 비동기 기록 (DB 실패는 도구 결과에 영향 없음은 feedback-tool.spec에서 검증)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { TelemetryEventsMigration } from '../../../../infrastructure/database/database/migration/migrations/027-telemetry-events.js';
import { TelemetryDailyMetricsMigration } from '../../../../infrastructure/database/database/migration/migrations/028-telemetry-daily-metrics.js';
import { TelemetryRepository } from '../../../telemetry/repositories/telemetry-repository.js';
import { TelemetryService } from '../../../telemetry/services/telemetry-service.js';
import { FeedbackTool } from '../feedback-tool.js';
import { RecallTool } from '../recall-tool.js';
import type { ToolContext } from '../../../../tools/types.js';

describe('telemetry instrumentation (feedback + service)', () => {
  let db: Database.Database;
  let telemetryService: TelemetryService;

  beforeEach(async () => {
    db = new Database(':memory:');
    await DatabaseUtils.initializeDatabase(db);
    await new TelemetryEventsMigration().up(db);
    await new TelemetryDailyMetricsMigration().up(db);
    db.prepare(
      `INSERT INTO memory_item (id, type, content) VALUES ('mem_tel_fb', 'semantic', 'x')`
    ).run();
    const repo = new TelemetryRepository(db);
    telemetryService = new TelemetryService(repo);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it('성공 피드백 후 telemetry_events에 latency·feedback 이벤트가 기록된다', async () => {
    const tool = new FeedbackTool();
    const context: ToolContext = {
      db,
      agentId: 'agent-tel',
      services: { telemetryService }
    };
    const r = await tool.handle({ memory_id: 'mem_tel_fb', helpful: true }, context);
    const text = r.content[0]?.text;
    expect(text).toBeDefined();
    expect(JSON.parse(text!).success).toBe(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    const row = db
      .prepare(
        `SELECT event_type, outcome, latency_ms FROM telemetry_events
         WHERE event_type IN ('memory.feedback.positive','memory.feedback.negative')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get() as { event_type: string; outcome: string; latency_ms: number | null };
    expect(row.event_type).toBe('memory.feedback.positive');
    expect(row.outcome).toBe('success');
    expect(row.latency_ms).not.toBeNull();
  });

  it('runWithContext 안에서 연속 record는 동일 request_id를 쓴다', async () => {
    await telemetryService.runWithContext('owner-cor', async () => {
      telemetryService.record({ eventType: 'memory.search.requested', outcome: 'success' });
      telemetryService.record({ eventType: 'memory.search.empty', outcome: 'empty' });
      return undefined;
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    const rows = db
      .prepare(
        `SELECT request_id FROM telemetry_events
         WHERE event_type IN ('memory.search.requested','memory.search.empty')
         ORDER BY created_at,
           CASE event_type WHEN 'memory.search.requested' THEN 0 WHEN 'memory.search.empty' THEN 1 ELSE 2 END`
      )
      .all() as { request_id: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].request_id).toBe(rows[1].request_id);
  });

  it('recall 검색 단계 예외 시 memory.search.failed가 requested와 같은 request_id로 기록된다', async () => {
    const recall = new RecallTool();
    const hybrid = {
      isEmbeddingAvailable: () => true,
      search: async () => {
        throw new Error('simulated_search_fail');
      }
    };
    const context = {
      db,
      agentId: 'agent-rec',
      services: { telemetryService, hybridSearchEngine: hybrid }
    } as ToolContext;
    await expect(
      telemetryService.runWithContext('agent-rec', async () =>
        recall.handle({ query: 'q', type: 'episodic', limit: 5 }, context)
      )
    ).rejects.toThrow();
    await new Promise<void>(r => setImmediate(r));
    const rows = db
      .prepare(
        `SELECT event_type, request_id, outcome FROM telemetry_events
         WHERE event_type IN ('memory.search.requested','memory.search.failed')
         ORDER BY created_at,
           CASE event_type WHEN 'memory.search.requested' THEN 0 WHEN 'memory.search.failed' THEN 1 ELSE 2 END`
      )
      .all() as { event_type: string; request_id: string; outcome: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].event_type).toBe('memory.search.requested');
    expect(rows[1].event_type).toBe('memory.search.failed');
    expect(rows[0].request_id).toBe(rows[1].request_id);
    expect(rows[1].outcome).toBe('failure');
  });

  it('recall 성공(빈 결과) 시 requested → candidates_retrieved → reranked → empty 체인이 동일 request_id로 기록된다', async () => {
    const recall = new RecallTool();
    const hybrid = {
      isEmbeddingAvailable: () => true,
      search: async () => ({ items: [], total_count: 0 })
    };
    const context = {
      db,
      agentId: 'agent-rec-ok',
      services: { telemetryService, hybridSearchEngine: hybrid }
    } as ToolContext;
    await telemetryService.runWithContext('agent-rec-ok', async () =>
      recall.handle(
        { query: 'empty-query', type: 'episodic', limit: 5, enable_hybrid: true },
        context
      )
    );
    await new Promise<void>(r => setImmediate(r));
    const rows = db
      .prepare(
        `SELECT event_type, request_id, outcome FROM telemetry_events
         WHERE event_type IN (
           'memory.search.requested',
           'memory.search.candidates_retrieved',
           'memory.search.reranked',
           'memory.search.empty'
         )
         ORDER BY created_at,
           CASE event_type
             WHEN 'memory.search.requested' THEN 0
             WHEN 'memory.search.candidates_retrieved' THEN 1
             WHEN 'memory.search.reranked' THEN 2
             WHEN 'memory.search.empty' THEN 3
             ELSE 9
           END`
      )
      .all() as { event_type: string; request_id: string; outcome: string }[];
    expect(rows).toHaveLength(4);
    const rid = rows[0].request_id;
    expect(rows.every(r => r.request_id === rid)).toBe(true);
    expect(rows.map(r => r.event_type)).toEqual([
      'memory.search.requested',
      'memory.search.candidates_retrieved',
      'memory.search.reranked',
      'memory.search.empty'
    ]);
    expect(rows[3].outcome).toBe('empty');
  });
});
