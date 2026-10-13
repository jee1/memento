import { describe, expect, it } from 'vitest';
import { RelationVisualizer } from '../relation-visualizer.js';
import type { MemoryRelation } from '../../types/relation-graph.js';

function relation(id: number, source: string, target: string, confidence: number): MemoryRelation {
  return {
    id,
    source_id: source,
    target_id: target,
    relation_type: 'CAUSES',
    confidence,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
}

describe('RelationVisualizer.visualizeSubgraph', () => {
  const relations = [relation(1, 'a', 'b', 0.9), relation(2, 'c', 'b', 0.5), relation(3, 'b', 'd', 0.75)];

  it('나가고 들어오는 간선을 hop 별로 그린다', () => {
    expect(RelationVisualizer.visualizeSubgraph('b', relations)).toBe([
      '중심 메모리: b',
      '',
      '[1-hop 관계]',
      '   b -->[CAUSES] d (confidence: 0.75)',
      '   a -->[CAUSES] b (confidence: 0.90)',
      '   c -->[CAUSES] b (confidence: 0.50)',
      '',
    ].join('\n'));
  });

  it('표시 옵션을 끄면 id·유형·신뢰도를 뺀다', () => {
    const text = RelationVisualizer.visualizeSubgraph('a', relations, {
      maxDepth: 2,
      showMemoryIds: false,
      showRelationTypes: false,
      showConfidence: false,
    });
    expect(text).toBe(['중심 메모리: a', '', '[1-hop 관계]', '   -->', '', '[2-hop 관계]', '     -->', '     -->', ''].join('\n'));
  });

  it('신뢰도 필터에 다 걸리면 관계가 없다', () => {
    expect(RelationVisualizer.visualizeSubgraph('b', relations, { minConfidence: 0.95 }))
      .toBe('중심 메모리: b\n관계가 없습니다.');
  });
});
