import { describe, expect, it, vi } from 'vitest';
import { initializeDatabase } from '@memento/core';
import type { HybridSearchResult } from '@memento/core/domains/search/algorithms/hybrid-search-types.js';
import { expandPoolWithBfs } from './relation-bfs-eval-runner.js';

vi.mock('@memento/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memento/core')>();
  return {
    ...actual,
    createRelationGraph: () => ({
      getRelatedMemories: async (seedId: string) => {
        if (seedId !== 'seed_mem') {
          return [];
        }
        return [
          {
            memory_id: 'seed_mem',
            relation_path: [{ relation_type: 'FOLLOWS' }],
          },
        ];
      },
    }),
  };
});

describe('expandPoolWithBfs', () => {
  it('does not throw when safety meta is missing for a mapped benchmark id', async () => {
    const db = await initializeDatabase(':memory:');
    try {
      const hybrid: HybridSearchResult[] = [
        {
          id: 'seed_mem',
          content: '',
          type: 'semantic',
          importance: 0,
          created_at: '',
          pinned: false,
          textScore: 0,
          vectorScore: 0,
          finalScore: 0.9,
          recall_reason: 'test',
        },
      ];
      const memoryIdToBenchmarkId = new Map([['seed_mem', 'bench_seed']]);
      const safetyMetaByBenchmarkId = new Map<string, never>();
      await expect(
        expandPoolWithBfs(
          db,
          hybrid,
          { maxHops: 1, maxSeeds: 1, bfsLimit: 5 },
          'owner_a',
          [],
          memoryIdToBenchmarkId,
          safetyMetaByBenchmarkId,
        ),
      ).resolves.toBeDefined();
    } finally {
      db.close();
    }
  });
});
