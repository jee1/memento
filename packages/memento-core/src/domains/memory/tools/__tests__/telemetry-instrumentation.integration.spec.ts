/**
 * T014: 피드백 도구 + TelemetryService — 도구 성공 후 텔레메트리 비동기 기록 (DB 실패는 도구 결과에 영향 없음은 feedback-tool.spec에서 검증)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TelemetryEventsMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/027-telemetry-events.js';
import { TelemetryDailyMetricsMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/028-telemetry-daily-metrics.js';
import { AgentIntegrationSchemaMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/035-agent-integration-schema.js';
import { AgentMemoryPromotionSchemaMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/036-agent-memory-promotion-schema.js';
import { TelemetryRepository } from '../../../telemetry/repositories/telemetry-repository.js';
import { TelemetryService } from '../../../telemetry/services/telemetry-service.js';
import { FeedbackTool } from '../feedback-tool.js';
import { RecallTool } from '../../recall/recall-tool.js';
import type { ToolContext } from '../../../../tools/types.js';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('telemetry instrumentation (feedback + service)', () => {
  let db: Database.Database;
  let telemetryService: TelemetryService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    await new AgentIntegrationSchemaMigration().up(db);
    await new AgentMemoryPromotionSchemaMigration().up(db);
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

  it('승급 기억 피드백은 downstream usage telemetry에도 연결된다', async () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content) VALUES ('mem_tel_summary', 'episodic', 'summary')`
    ).run();
    db.prepare(`
      INSERT INTO agent_session (
        id, adapter_name, adapter_version, contract_version, status,
        started_at, last_event_at, max_sequence_no, summary_memory_id,
        created_at, updated_at
      ) VALUES (
        'session-feedback', 'codex', '1.0.0', 1, 'COMPLETED',
        '2026-06-07T00:00:00.000Z', '2026-06-07T00:00:01.000Z', 1,
        'mem_tel_summary', '2026-06-07T00:00:00.000Z', '2026-06-07T00:00:01.000Z'
      )
    `).run();
    db.prepare(`
      INSERT INTO agent_memory_promotion_candidate (
        id, fingerprint, session_id, summary_memory_id, target_type, category,
        content, confidence, evidence_observation_ids_json, status, memory_id,
        created_at, updated_at, reviewed_at
      ) VALUES (
        'promotion-feedback', ?, 'session-feedback', 'mem_tel_summary',
        'semantic', 'decision', 'x', 0.85, '[]', 'approved', 'mem_tel_fb',
        '2026-06-07T00:00:01.000Z', '2026-06-07T00:00:01.000Z',
        '2026-06-07T00:00:01.000Z'
      )
    `).run('f'.repeat(64));
    const tool = new FeedbackTool();
    const context: ToolContext = {
      db,
      agentId: 'agent-tel',
      services: { telemetryService }
    };

    await tool.handle({ memory_id: 'mem_tel_fb', helpful: false }, context);
    await new Promise<void>(resolve => setImmediate(resolve));

    const row = db.prepare(`
      SELECT event_type, outcome, extra_data
      FROM telemetry_events
      WHERE event_type = 'agent.promotion.usage'
      ORDER BY created_at DESC LIMIT 1
    `).get() as { event_type: string; outcome: string; extra_data: string };
    expect(row.event_type).toBe('agent.promotion.usage');
    expect(row.outcome).toBe('failure');
    expect(JSON.parse(row.extra_data)).toEqual(expect.objectContaining({
      memoryId: 'mem_tel_fb',
      candidateId: 'promotion-feedback',
      usageOutcome: 'negative'
    }));
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

  it('recall은 실제 ranking profile과 text/vector/union/reranked funnel 수를 기록한다', async () => {
    const recall = new RecallTool();
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `m-${i}`,
      content: `memory ${i}`,
      type: 'episodic',
      importance: 0.5,
      created_at: new Date().toISOString(),
      owner_id: i < 5 ? 'agent-funnel' : 'other-agent',
      finalScore: 1 - i / 100
    }));
    const hybrid = {
      isEmbeddingAvailable: () => true,
      getRankingVersion: () => 'ranking-sha256:custom123',
      search: async () => ({
        items,
        total_count: 10,
        text_count: 12,
        vector_count: 14,
        union_count: 20,
        reranked_count: 10
      })
    };
    const context = {
      db,
      agentId: 'agent-funnel',
      services: { telemetryService, hybridSearchEngine: hybrid }
    } as ToolContext;

    await telemetryService.runWithContext('agent-funnel', () =>
      recall.handle({
        query: 'funnel',
        type: 'episodic',
        limit: 5,
        owner_id: 'agent-funnel'
      }, context)
    );
    await new Promise<void>(resolve => setImmediate(resolve));

    const rows = db.prepare(`
      SELECT event_type, extra_data FROM telemetry_events
      WHERE owner_id = 'agent-funnel'
      ORDER BY created_at,
        CASE event_type
          WHEN 'memory.search.requested' THEN 0
          WHEN 'memory.search.candidates_retrieved' THEN 1
          WHEN 'memory.search.reranked' THEN 2
          WHEN 'memory.search.selected' THEN 3
          ELSE 9
        END
    `).all() as Array<{ event_type: string; extra_data: string }>;
    const extras = Object.fromEntries(rows.map(row => [row.event_type, JSON.parse(row.extra_data)]));
    expect(extras['memory.search.requested'].ranking_version).toBe('ranking-sha256:custom123');
    expect(extras['memory.search.candidates_retrieved']).toMatchObject({
      candidate_count: 20,
      text_candidate_count: 12,
      vector_candidate_count: 14,
      union_candidate_count: 20
    });
    expect(extras['memory.search.reranked']).toMatchObject({ candidate_count: 10, reranked_count: 10 });
    expect(extras['memory.search.selected']).toMatchObject({ selected_count: 5 });
  });
});
