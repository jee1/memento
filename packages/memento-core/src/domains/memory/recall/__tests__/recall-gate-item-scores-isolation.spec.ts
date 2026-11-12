/**
 * #1682: gate_item_scores 는 엔진 응답 최상위만. recall 항목·rejection_gate 로 새지 않는다.
 */
import { describe, expect, it } from 'vitest';

describe('recall gate_item_scores 격리 (#1682)', () => {
  it('항목 복사와 rejection_gate 메타는 새 필드를 갖지 않는다', () => {
    const searchResult = {
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
      rejection_gate: { verdict: 'passed' as const, top_score: 0.9, unscored: 0 },
      gate_item_scores: [{ id: 'm1', score: 0.9 }],
    };

    const item = { ...searchResult.items[0] };
    const metadata = {
      rejection_gate: searchResult.rejection_gate,
    };

    expect(item).not.toHaveProperty('gate_score');
    expect(item).not.toHaveProperty('gate_item_scores');
    expect(Object.keys(metadata.rejection_gate).sort()).toEqual([
      'top_score',
      'unscored',
      'verdict',
    ]);
    expect(metadata).not.toHaveProperty('gate_item_scores');
  });
});
