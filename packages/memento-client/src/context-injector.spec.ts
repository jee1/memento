import { describe, it, expect } from 'vitest';
import { ContextInjector } from './context-injector.js';
import type { MementoClient } from './memento-client.js';
import type { MemoryItem } from './types.js';

type ScoredMemory = MemoryItem & { score?: number; finalScore?: number };

const buildMemory = (overrides: Partial<ScoredMemory> = {}): ScoredMemory => ({
  id: 'memory-1',
  content: 'Default content',
  type: 'semantic',
  importance: 0.5,
  created_at: '2026-10-01T00:00:00.000Z',
  pinned: false,
  tags: [],
  privacy_scope: 'private',
  ...overrides
});

// #1182: score 와 importance 가 서로 반대인 두 후보. 옛 비교자는 입력 순서와 무관하게 high 를 앞에 뒀다.
const high = buildMemory({ id: 'high', content: 'HIGH_SCORE_LOW_IMPORTANCE', finalScore: 0.9, score: 0.9, importance: 0.1 });
const low = buildMemory({ id: 'low', content: 'LOW_SCORE_HIGH_IMPORTANCE', finalScore: 0.5, score: 0.5, importance: 0.9 });

const order = (content: string): string[] =>
  ['HIGH_SCORE_LOW_IMPORTANCE', 'LOW_SCORE_HIGH_IMPORTANCE'].sort((a, b) => content.indexOf(a) - content.indexOf(b));

describe('ContextInjector memory order (#1182)', () => {
  it.each([
    [[high, low], ['HIGH_SCORE_LOW_IMPORTANCE', 'LOW_SCORE_HIGH_IMPORTANCE']],
    [[low, high], ['LOW_SCORE_HIGH_IMPORTANCE', 'HIGH_SCORE_LOW_IMPORTANCE']]
  ])('inject keeps the server order without re-sorting by importance', async (items, expected) => {
    const client = {
      hybridSearch: async () => ({ items, total_count: items.length, query_time: 1 })
    } as unknown as MementoClient;

    const result = await new ContextInjector(client).inject('query', { tokenBudget: 10_000 });

    expect(result.metadata.memories_used).toBe(2);
    expect(order(result.content)).toEqual(expected);
  });

  it('injectProjectContext does not reorder the caller array', async () => {
    const items = [low, high];
    const client = {
      recall: async () => ({ items, total_count: items.length, query_time: 1 })
    } as unknown as MementoClient;

    const result = await new ContextInjector(client).injectProjectContext('project-1', 'query', 10_000);

    expect(items.map((item) => item.id)).toEqual(['low', 'high']);
    expect(order(result.content)).toEqual(['LOW_SCORE_HIGH_IMPORTANCE', 'HIGH_SCORE_LOW_IMPORTANCE']);
  });
});
