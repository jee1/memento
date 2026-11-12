/**
 * #1682: gate_item_scores 는 엔진 응답 최상위만. recall 항목과 rejection_gate 로 새지 않는다.
 */
import { expect, it, vi } from 'vitest';
import { describeRecallTool, tool, context, hybridSearchEngine } from './recall-tool.test-setup.js';

describeRecallTool('gate_item_scores 격리 (#1682)', () => {
  it('RecallTool.handle 응답에 gate_score/gate_item_scores 가 없고 rejection_gate 키만 유지한다', async () => {
    vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
      items: [
        {
          id: 'm1',
          content: '본문',
          type: 'semantic',
          importance: 0.9,
          created_at: '2026-01-01T00:00:00.000Z',
          pinned: false,
          textScore: 1,
          vectorScore: 0,
          finalScore: 1,
          recall_reason: 'hybrid',
        },
      ],
      total_count: 1,
      query_time: 1,
      rejection_gate: { verdict: 'passed' as const, top_score: 0.9, unscored: 0 },
      gate_item_scores: [{ id: 'm1', score: 0.9 }],
    });

    const result = await tool.handle(
      { query: '본문', type: 'semantic', include_metadata: true },
      context,
    );
    const data = JSON.parse(result.content[0].text) as {
      items: Record<string, unknown>[];
      metadata?: Record<string, unknown>;
      gate_item_scores?: unknown;
    };

    expect(data.items).toHaveLength(1);
    for (const item of data.items) {
      expect(item).not.toHaveProperty('gate_score');
      expect(item).not.toHaveProperty('gate_item_scores');
    }
    const rejectionGate = data.metadata?.rejection_gate as Record<string, unknown> | undefined;
    expect(rejectionGate).toBeDefined();
    expect(Object.keys(rejectionGate!).sort()).toEqual(['top_score', 'unscored', 'verdict']);
    expect(data).not.toHaveProperty('gate_item_scores');
    expect(data.metadata).not.toHaveProperty('gate_item_scores');
  });
});
