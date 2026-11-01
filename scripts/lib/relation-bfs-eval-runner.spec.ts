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
        if (seedId === 'seed_a') {
          return [
            {
              memory_id: 'target_mem',
              relation_path: [{ relation_type: 'FOLLOWS' }],
            },
          ];
        }
        return [];
      },
    }),
  };
});

function hybridItem(id: string, finalScore: number): HybridSearchResult {
  return {
    id,
    content: '',
    type: 'semantic',
    importance: 0,
    created_at: '',
    pinned: false,
    textScore: 0,
    vectorScore: 0,
    finalScore,
    recall_reason: 'test',
  };
}

describe('expandPoolWithBfs', () => {
  it('does not throw when safety meta is missing for a mapped benchmark id', async () => {
    const db = await initializeDatabase(':memory:');
    try {
      const hybrid = [hybridItem('seed_mem', 0.9)];
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

  it('does not mutate hybrid cache when BFS raises an in-pool candidate score', async () => {
    const db = await initializeDatabase(':memory:');
    try {
      const target = hybridItem('target_mem', 0.4);
      const hybrid = [hybridItem('seed_a', 0.95), target];
      const memoryIdToBenchmarkId = new Map([
        ['seed_a', 'bench_seed'],
        ['target_mem', 'bench_target'],
      ]);
      const safetyMetaByBenchmarkId = new Map<string, never>();
      const scoreBefore = target.finalScore;
      const merged = await expandPoolWithBfs(
        db,
        hybrid,
        { maxHops: 1, maxSeeds: 1, bfsLimit: 5 },
        'owner_a',
        [],
        memoryIdToBenchmarkId,
        safetyMetaByBenchmarkId,
      );
      expect(target.finalScore).toBe(scoreBefore);
      const boosted = merged.find((row) => row.id === 'target_mem');
      expect(boosted?.finalScore).toBeGreaterThan(scoreBefore);
    } finally {
      db.close();
    }
  });
});
