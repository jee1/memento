import { describe, expect, it } from 'vitest';
import {
  createProviderVectorSearchTask,
  executeProviderSearchesWithOverallTimeout,
  type ProviderVectorSearchDeps,
} from '../hybrid-search-provider-parallel.js';

const searchOptions = { limit: 1, threshold: 0, includeContent: true };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('provider lane clocks', () => {
  it('uses the max finished embed and vector clocks across providers', async () => {
    const deps: ProviderVectorSearchDeps = {
      generateQueryVector: async (_query, _searchId, preferred) => {
        await delay(40);
        return { embedding: [1], actualProvider: preferred };
      },
      vectorSearch: async () => {
        await delay(40);
        return [];
      },
      logSearchStep: () => {},
    };
    const providers = ['minilm', 'openai'] as const;
    const tasks = providers.map((provider) =>
      createProviderVectorSearchTask(deps, provider, 'q', searchOptions, 'sid')
    );
    const summary = await executeProviderSearchesWithOverallTimeout(
      tasks,
      [...providers],
      'sid',
      () => {},
    );

    expect(summary.embedding_ms).toBeGreaterThanOrEqual(30);
    expect(summary.embedding_ms).toBeLessThan(70);
    expect(summary.vector_ms).toBeGreaterThanOrEqual(30);
    expect(summary.vector_ms).toBeLessThan(70);
  });

  it('omits vector_ms when every provider skips KNN', async () => {
    const deps: ProviderVectorSearchDeps = {
      generateQueryVector: async () => ({ embedding: [1], actualProvider: 'tfidf' }),
      vectorSearch: async () => {
        throw new Error('knn should not run');
      },
      logSearchStep: () => {},
    };
    const providers = ['minilm', 'openai'] as const;
    const tasks = providers.map((provider) =>
      createProviderVectorSearchTask(deps, provider, 'q', searchOptions, 'sid')
    );
    const summary = await executeProviderSearchesWithOverallTimeout(
      tasks,
      [...providers],
      'sid',
      () => {},
    );

    expect(summary.embedding_ms).toEqual(expect.any(Number));
    expect(summary.vector_ms).toBeUndefined();
  });

  it('omits both lane keys when embedding never finishes', async () => {
    const deps: ProviderVectorSearchDeps = {
      generateQueryVector: async () => {
        throw new Error('embed down');
      },
      vectorSearch: async () => [],
      logSearchStep: () => {},
    };
    const tasks = [
      createProviderVectorSearchTask(deps, 'minilm', 'q', searchOptions, 'sid'),
    ];
    const summary = await executeProviderSearchesWithOverallTimeout(tasks, ['minilm'], 'sid', () => {});

    expect(summary.embedding_ms).toBeUndefined();
    expect(summary.vector_ms).toBeUndefined();
  });
});
