/**
 * SC-002: consolidation과 recall 병행 시 레이턴시 스모크.
 * 에피소딕 부하는 소량(10)이며, 대량(500) 전제는 `test-sleep-consolidation.spec.ts`(SC-004)를 본다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../infrastructure/database/database/init.js';
import { initializeServices } from '../bootstrap.js';
import type { ServerServices } from '../bootstrap.js';
import { cleanupTestDatabase, createTestMemory } from './helpers/test-database.js';
import { insertMemoryEmbedding } from './helpers/consolidation-test-data.js';
import { RecallTool } from '../domains/memory/tools/recall-tool.js';
import type { ToolContext } from '../tools/types.js';

describe('test-sleep-consolidation-isolation', () => {
  let db: Database.Database;
  let services: ServerServices;
  let context: ToolContext;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    delete process.env.OPENAI_API_KEY;
    db = await initializeDatabase(':memory:');
    services = await initializeServices(db);
    context = {
      db,
      services: {
        hybridSearchEngine: services.hybridSearchEngine,
        embeddingService: services.embeddingService,
        vectorSearchEngine: services.vectorSearchEngine
      }
    };
  });

  afterEach(async () => {
    try {
      await services.batchScheduler?.stop();
    } catch {
      /* ignore */
    }
    await cleanupTestDatabase(db);
  });

  // SC-002: 베이스 대비 recall 총 시간 ≤ ceil(base×1.1)+5ms (워밍업 1회 후 측정, 타이머 지터만 소량 허용)
  it('SC-002: consolidation 병행 시 recall이 베이스 대비 10% 이내(워밍업·지터)', async () => {
    const vec = new Array(384).fill(0);
    vec[0] = 0.5;
    for (let i = 0; i < 10; i++) {
      createTestMemory(db, {
        id: `iso_${i}`,
        type: 'episodic',
        content: `latency test content ${i}`,
        importance: 0.5
      });
      insertMemoryEmbedding(db, {
        memory_id: `iso_${i}`,
        embedding: vec,
        embedding_provider: 'minilm',
        dim: 384
      });
    }

    const recall = new RecallTool();
    const measureRecall = async () => {
      const t0 = Date.now();
      for (let k = 0; k < 10; k++) {
        await recall.handle(
          {
            query: 'latency test',
            limit: 5,
            type: 'episodic',
            include_metadata: false
          } as any,
          context
        );
      }
      return Date.now() - t0;
    };

    await measureRecall();
    const base = await measureRecall();
    const cons = services.sleepConsolidationService!.run({});
    const during = await measureRecall();
    await cons;

    const jitterMs = 5;
    const ceiling = Math.ceil(base * 1.1) + jitterMs;
    expect(during).toBeLessThanOrEqual(ceiling);
  }, 120_000);
});
