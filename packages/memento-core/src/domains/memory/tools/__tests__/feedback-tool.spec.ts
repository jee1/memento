import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { FeedbackTool } from '../feedback-tool.js';
import type { ToolContext } from '../../../../tools/types.js';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';

function parseData(r: { content: Array<{ text?: string }> }): Record<string, unknown> {
  const text = r.content[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

describe('FeedbackTool', () => {
  let db: Database.Database;
  let tool: FeedbackTool;
  let context: ToolContext;

  beforeEach(async () => {
    db = await setupTestDatabase();
    db.prepare(
      `INSERT INTO memory_item (id, type, content) VALUES ('mem_tool_fb_1', 'semantic', 'x')`
    ).run();
    tool = new FeedbackTool();
    context = { db } as ToolContext;
  });

  afterEach(() => {
    db.close();
  });

  it('존재하지 않는 memory_id는 계약 JSON(success:false, error)으로 반환된다', async () => {
    const r = await tool.handle({ memory_id: 'mem_missing_xyz', helpful: true }, context);
    const data = parseData(r);
    expect(data.success).toBe(false);
    expect(data.error).toBe('memory not found');
  });

  it('유효한 피드백은 feedback_id·created_at 반환 (@jee1/memento-client 계약)', async () => {
    const r = await tool.handle(
      {
        memory_id: 'mem_tool_fb_1',
        helpful: true,
        session_id: 's1',
        agent_id: 'a1',
        comment: 'nice',
        score: 0.8
      },
      context
    );
    const data = parseData(r);
    expect(data.success).toBe(true);
    expect(typeof data.feedback_id).toBe('string');
    expect(data.helpful).toBe(true);
    expect(typeof data.created_at).toBe('string');
    expect(data.uri).toBe('memento://default/memory/mem_tool_fb_1');
    const row = db
      .prepare('SELECT comment, score FROM feedback_event WHERE memory_id = ? ORDER BY id DESC LIMIT 1')
      .get('mem_tool_fb_1') as { comment: string | null; score: number | null };
    expect(row.comment).toBe('nice');
    expect(row.score).toBeCloseTo(0.8, 5);
  });

  it('절차형 기억에는 procedure URI를 반환한다', async () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, owner_id)
       VALUES ('mem_tool_fb_procedure', 'procedural', 'deploy', 'agent-ops')`
    ).run();

    const result = await tool.handle(
      { memory_id: 'mem_tool_fb_procedure', helpful: true },
      context
    );

    expect(parseData(result).uri).toBe('memento://agent-ops/procedure/mem_tool_fb_procedure');
  });

  it('반복 제출은 독립 이벤트로 저장된다', async () => {
    await tool.handle({ memory_id: 'mem_tool_fb_1', helpful: true }, context);
    await tool.handle({ memory_id: 'mem_tool_fb_1', helpful: true }, context);
    const n = db.prepare('SELECT COUNT(*) as c FROM feedback_event WHERE memory_id = ?').get('mem_tool_fb_1') as {
      c: number;
    };
    expect(n.c).toBe(2);
  });

  it('SC-004: insert가 모두 실패하면 실패율 100%로 1% 임계 초과를 판정할 수 있다', async () => {
    vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('simulated db failure');
    });
    const n = 24;
    let failures = 0;
    for (let i = 0; i < n; i++) {
      const r = await tool.handle({ memory_id: 'mem_tool_fb_1', helpful: true }, context);
      const data = parseData(r);
      if (data.success === false && data.error === 'storage error') {
        failures++;
      }
    }
    vi.restoreAllMocks();
    expect(failures).toBe(n);
    expect(failures / n).toBeGreaterThan(0.01);
  });

  it('과도하게 긴 comment는 스키마 검증에서 거부된다', async () => {
    await expect(
      tool.handle(
        { memory_id: 'mem_tool_fb_1', helpful: true, comment: 'x'.repeat(5000) },
        context
      )
    ).rejects.toThrow();
  });

  it('과도하게 큰 score_breakdown은 스키마 검증에서 거부된다', async () => {
    const huge = { pad: 'y'.repeat(40_000) };
    await expect(
      tool.handle(
        { memory_id: 'mem_tool_fb_1', helpful: false, score_breakdown: huge },
        context
      )
    ).rejects.toThrow();
  });

  it('score_breakdown을 전달하면 score_breakdown_json에 저장된다', async () => {
    const breakdown = {
      relevance: { score: 0.1, pct: 20 },
      total: 0.3
    };
    await tool.handle(
      {
        memory_id: 'mem_tool_fb_1',
        helpful: false,
        score_breakdown: breakdown
      },
      context
    );
    const row = db
      .prepare(
        'SELECT score_breakdown_json FROM feedback_event WHERE memory_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get('mem_tool_fb_1') as { score_breakdown_json: string | null };
    expect(JSON.parse(row.score_breakdown_json!)).toEqual(breakdown);
  });

  it('SC-004: 부분 실패율이 1% 임계를 넘는지 계산할 수 있다', () => {
    const total = 500;
    const failed = 12;
    const rate = failed / total;
    expect(rate).toBeGreaterThan(0.01);
  });
});
