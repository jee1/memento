import { describe, expect, it, vi } from 'vitest';
import type { MemoryItem, MemoryType } from '../../../../shared/types/memory.types.js';
import type { SystemOneClient, SystemOneFailureReason } from '../../../../shared/services/typesafe/system-one-client.js';
import type { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import {
  JevRelationJudge,
  RELATION_JEV_TYPE_MIN,
  selectWinningType,
} from '../jev-relation-judge.js';

function memory(id: string, content: string, type: MemoryType = 'episodic'): MemoryItem {
  return {
    id,
    type,
    content,
    importance: 0.5,
    privacy_scope: 'private',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    pinned: false,
  };
}

function scored(entries: ReadonlyArray<readonly [string, number]>) {
  return { ok: true as const, noulById: new Map(entries), wafRetried: false };
}

function failed(reason: SystemOneFailureReason) {
  return { ok: false as const, reason, wafRetried: false };
}

const embedding = {
  generateEmbedding: () => Promise.reject(new Error('pool should not embed under the limit')),
  searchSimilar: () => Promise.reject(new Error('pool should not search under the limit')),
} as unknown as UnifiedEmbeddingService;

describe('selectWinningType', () => {
  it('drops scores under the floor and breaks a tie toward the earlier type', () => {
    expect(selectWinningType(new Map([
      ['CAUSES', 0.42],
      ['FOLLOWS', 0.71],
      ['REFERENCES', 0.71],
    ]), RELATION_JEV_TYPE_MIN)).toEqual({ type: 'FOLLOWS', confidence: 0.71 });
  });

  it('accepts a score equal to the floor and ignores non-finite values', () => {
    expect(selectWinningType(new Map([
      ['CAUSES', 0.5],
      ['FOLLOWS', Number.NaN],
      ['REFERENCES', Number.POSITIVE_INFINITY],
    ]), RELATION_JEV_TYPE_MIN)).toEqual({ type: 'CAUSES', confidence: 0.5 });
  });

  it('returns null when every finite score is below the floor', () => {
    expect(selectWinningType(new Map([
      ['CAUSES', 0.49],
      ['BELONGS_TO', 0.1],
    ]), RELATION_JEV_TYPE_MIN)).toBeNull();
  });
});

describe('JevRelationJudge', () => {
  it('stamps method jev with the winning noul and asks type questions only for relevance survivors', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.8], ['r1', 0.49]]))
      .mockResolvedValueOnce(scored([
        ['y0_CAUSES', 0.42],
        ['y0_FOLLOWS', 0.71],
        ['y0_REFERENCES', 0.71],
      ]));
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);

    const result = await judge.judge(
      memory('new', 'n'.repeat(250)),
      [memory('keep', 'k'.repeat(250)), memory('drop', 'short')],
    );

    expect(result).toEqual({
      ok: true,
      candidates: [{
        source_id: 'new',
        target_id: 'keep',
        relation_type: 'FOLLOWS',
        confidence: 0.71,
        method: 'jev',
        evidence: 'FOLLOWS 0.71',
      }],
    });

    const firstState = ask.mock.calls[0]?.[0] as Record<string, string>;
    expect(firstState.s).toBe(`${'n'.repeat(200)}...`);
    expect(firstState.t0).toBe(`${'k'.repeat(200)}...`);
    expect(firstState).not.toHaveProperty('keep');

    const typeQuestions = ask.mock.calls[1]?.[1] as Array<{ id: string; instructions: string }>;
    expect(typeQuestions.map((question) => question.id)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^y1_/)]),
    );
    expect(typeQuestions.map((question) => question.id)).toEqual([
      'y0_CAUSES',
      'y0_FOLLOWS',
      'y0_CONTRASTS_WITH',
      'y0_REFERENCES',
      'y0_BELONGS_TO',
    ]);
    expect(typeQuestions.find((question) => question.id === 'y0_CAUSES')?.instructions)
      .toBe('새 기억(s)이 기존 기억(t0)의 원인이다');
    expect(ask.mock.calls[0]?.[1]?.[0]?.instructions)
      .toBe('기존 기억(t0)은 새 기억(s)과 같은 구체적 작업 흐름이나 사건의 맥락으로 이어 볼 만하다');
    expect(typeQuestions.find((question) => question.id === 'y0_FOLLOWS')?.instructions)
      .toBe('새 기억(s)의 사건·단계는 기존 기억(t0)과 같은 작업 흐름에서 그 뒤에 발생·실행된다. 인과는 필요 없다. 저장 순서·내용 반복·무관한 사건의 시간 인접만으로는 성립하지 않는다');
    expect(typeQuestions.find((question) => question.id === 'y0_CONTRASTS_WITH')?.instructions)
      .toBe('새 기억(s)과 기존 기억(t0)은 같은 대상의 같은 비교 축에서 서로 다른 주장·선택지·조건을 대조한다. 같은 내용 반복·동급 작업·단순 후속 실행은 대조가 아니다');
  });

  it('sorts candidates by confidence descending', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.9], ['r1', 0.9]]))
      .mockResolvedValueOnce(scored([
        ['y0_FOLLOWS', 0.6],
        ['y1_CAUSES', 0.9],
      ]));
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);

    const result = await judge.judge(memory('new', 'source'), [
      memory('low', 'a'),
      memory('high', 'b'),
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates.map((candidate) => candidate.target_id)).toEqual(['high', 'low']);
      expect(result.candidates.map((candidate) => candidate.confidence)).toEqual([0.9, 0.6]);
    }
  });

  it('does not ask VERSION_OF for a procedural source', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.8]]))
      .mockResolvedValueOnce(scored([['y0_DEPENDS_ON', 0.8]]));
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);

    await judge.judge(memory('new', 'procedure', 'procedural'), [memory('old', 'step')]);

    const ids = (ask.mock.calls[1]?.[1] as Array<{ id: string }>).map((question) => question.id);
    expect(ids).toEqual(['y0_DEPENDS_ON', 'y0_FOLLOWS', 'y0_REFERENCES']);
    expect(ids.join(' ')).not.toContain('VERSION_OF');
    const typeQuestions = ask.mock.calls[1]?.[1] as Array<{ id: string; instructions: string }>;
    expect(typeQuestions.find((question) => question.id === 'y0_DEPENDS_ON')?.instructions)
      .toBe('새 기억(s)이 설명하는 대상이나 절차가 성립·실행되려면 기존 기억(t0)의 대상이 필수 전제로 필요하다. 단순 참조·내용 반복·시간 순서는 의존이 아니다');
  });

  it('passes the client failure reason through and does not emit an edge', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(failed('timeout'));
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);

    await expect(judge.judge(memory('new', 'source'), [memory('old', 'peer')]))
      .resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('drops the pair when the type round fails', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.9]]))
      .mockResolvedValueOnce(failed('waf'));
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);

    await expect(judge.judge(memory('new', 'source'), [memory('old', 'peer')]))
      .resolves.toEqual({ ok: false, reason: 'waf' });
  });

  it('returns no edges and does not call the client when the pool is empty', async () => {
    const ask = vi.fn();
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);

    await expect(judge.judge(memory('new', 'source'), [])).resolves.toEqual({
      ok: true,
      candidates: [],
    });
    expect(ask).not.toHaveBeenCalled();
  });
});
