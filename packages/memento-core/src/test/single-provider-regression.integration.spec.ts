import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  createMementoCore,
  createToolContext,
  executeTool,
  type MementoCoreInstance,
} from '../index.js';
import { insertMemoryEmbedding, insertMemoryItem } from './helpers/consolidation-test-data.js';

describe('single embedding provider regression', () => {
  let core: MementoCoreInstance;

  beforeAll(async () => {
    core = await createMementoCore({ dbPath: ':memory:' });
    for (let index = 0; index < 20; index += 1) {
      const id = `single-provider-${index}`;
      insertMemoryItem(core.db, {
        id,
        type: 'episodic',
        content: `single provider regression memory ${index}`,
      });
      insertMemoryEmbedding(core.db, {
        memory_id: id,
        embedding_provider: 'minilm',
        embedding: Array.from({ length: 384 }, (_, dimension) => (dimension + index) / 10_000),
        dim: 384,
      });
    }
  }, 30_000);

  afterAll(async () => {
    await core.services.batchScheduler?.stop();
    closeDatabase(core.db);
  });

  it('keeps average hybrid-search latency below the 500ms regression budget', async () => {
    const durations: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      await core.services.hybridSearchEngine.search(core.db, {
        query: 'single provider regression',
        limit: 10,
      });
      durations.push(performance.now() - startedAt);
    }

    const averageMs = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    expect(averageMs).toBeLessThanOrEqual(500);
  });

  it('returns seeded memories through the recall tool', async () => {
    const result = await executeTool(
      'recall',
      { query: 'single provider regression', type: 'episodic', limit: 10 },
      createToolContext(core.db, core.services),
    );
    const payload = JSON.parse(result.content[0]!.text) as { items?: unknown[] };

    expect(payload.items?.length).toBeGreaterThan(0);
  });

  it('retains exactly one stored embedding provider', () => {
    const providers = core.db
      .prepare('SELECT DISTINCT embedding_provider FROM memory_embedding ORDER BY embedding_provider')
      .all() as Array<{ embedding_provider: string }>;

    expect(providers).toEqual([{ embedding_provider: 'minilm' }]);
  });
});
