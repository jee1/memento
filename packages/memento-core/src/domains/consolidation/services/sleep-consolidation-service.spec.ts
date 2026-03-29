import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SleepConsolidationService } from './sleep-consolidation-service.js';
import { ConsolidationRepository } from '../repositories/consolidation-repository.js';
import { ClusteringService } from './clustering-service.js';
import { SummarizationService } from './summarization-service.js';
import { applyConsolidationTestSchema } from '../__tests__/consolidation-test-schema.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { IRelationGraph } from '../../../shared/types/relation-graph.js';

function insertEpisodic(
  db: Database.Database,
  id: string,
  opts?: { owner?: string | null; pinned?: boolean; importance?: number }
) {
  const owner = opts?.owner ?? null;
  const pinned = opts?.pinned ? 1 : 0;
  const imp = opts?.importance ?? 0.5;
  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (id, type, content, owner_id, pinned, importance, created_at)
     VALUES (?, 'episodic', ?, ?, ?, ?, datetime('now', '-1 day'))`,
    [id, `body-${id}`, owner, pinned, imp]
  );
}

function insertEmbedding(db: Database.Database, memoryId: string, vec: number[]) {
  DatabaseUtils.run(
    db,
    `INSERT INTO memory_embedding (memory_id, embedding, dim, embedding_provider)
     VALUES (?, ?, ?, 'tfidf')`,
    [memoryId, JSON.stringify(vec), vec.length]
  );
}

describe('SleepConsolidationService', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    db = new Database(':memory:');
    applyConsolidationTestSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates semantic, relations, and marks episodics consolidated', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const emb = [1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      const id = `e${i}`;
      insertEpisodic(db, id, { owner: 'agent-x' });
      insertEmbedding(db, id, emb);
    }

    const { createRelationGraph } = await import(
      '../../../infrastructure/relation-graph-factory.js'
    );
    const svc = new SleepConsolidationService(db, {
      relationGraph: createRelationGraph(db)
    });
    const result = await svc.run({ ownerIdFilter: 'agent-x' });
    expect(result.semanticsCreated).toBe(1);
    expect(result.episodicsConsolidated).toBe(10);
    expect(result.clustersProcessed).toBe(1);

    const sem = DatabaseUtils.get(
      db,
      `SELECT id, origin_source FROM memory_item WHERE type = 'semantic' LIMIT 1`
    ) as { id: string; origin_source: string };
    expect(sem).toBeTruthy();
    const origin = JSON.parse(sem.origin_source) as {
      context: { source_episodic_ids: string[]; summarization_method: string };
    };
    expect(origin.context.source_episodic_ids).toHaveLength(10);
    expect(origin.context.summarization_method).toBe('extractive');

    const semEmb = DatabaseUtils.get(
      db,
      `SELECT 1 AS ok FROM memory_embedding WHERE memory_id = ?`,
      [sem.id]
    ) as { ok: number } | undefined;
    expect(semEmb?.ok).toBe(1);

    const rel = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_relation WHERE relation_type = 'extracted_from'`
    ) as { c: number };
    expect(Number(rel.c)).toBe(10);

    const pending = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_item WHERE type = 'episodic' AND COALESCE(is_consolidated,0) = 0`
    ) as { c: number };
    expect(Number(pending.c)).toBe(0);
  });

  it('does not mark episodics when semantic insert fails (FR-003 order)', async () => {
    delete process.env.OPENAI_API_KEY;
    class FailingRepo extends ConsolidationRepository {
      insertSemanticMemory(): void {
        throw new Error('insert failed');
      }
    }
    const emb = [1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      const id = `e${i}`;
      insertEpisodic(db, id);
      insertEmbedding(db, id, emb);
    }
    const { createRelationGraph } = await import(
      '../../../infrastructure/relation-graph-factory.js'
    );
    const svc = new SleepConsolidationService(db, {
      consolidationRepository: new FailingRepo(db),
      relationGraph: createRelationGraph(db)
    });
    const result = await svc.run({});
    expect(result.semanticsCreated).toBe(0);
    const unmarked = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_item WHERE type = 'episodic' AND COALESCE(is_consolidated,0) = 0`
    ) as { c: number };
    expect(Number(unmarked.c)).toBe(10);
  });

  it('continues other clusters when one fails (FR-009)', async () => {
    delete process.env.OPENAI_API_KEY;
    const embA = [1, 0, 0, 0];
    const embB = [0, 1, 0, 0];
    for (let i = 0; i < 5; i++) {
      insertEpisodic(db, `a${i}`, { owner: 'o1' });
      insertEmbedding(db, `a${i}`, embA);
    }
    for (let i = 0; i < 5; i++) {
      insertEpisodic(db, `b${i}`, { owner: 'o1' });
      insertEmbedding(db, `b${i}`, embB);
    }

    let calls = 0;
    const mockRg: IRelationGraph = {
      addRelation: vi.fn(async () => {
        calls++;
        if (calls === 1) {
          throw new Error('relation boom');
        }
        return 1;
      }),
      getRelations: vi.fn(),
      getRelatedMemories: vi.fn(),
      removeRelation: vi.fn(),
      updateConfidence: vi.fn(),
      detectCycle: vi.fn()
    } as unknown as IRelationGraph;

    const svc = new SleepConsolidationService(db, { relationGraph: mockRg });
    const result = await svc.run({ ownerIdFilter: 'o1' });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.semanticsCreated).toBe(1);
  });

  it('dryRun does not persist changes', async () => {
    delete process.env.OPENAI_API_KEY;
    const emb = [1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      insertEpisodic(db, `e${i}`);
      insertEmbedding(db, `e${i}`, emb);
    }
    const { createRelationGraph } = await import(
      '../../../infrastructure/relation-graph-factory.js'
    );
    const svc = new SleepConsolidationService(db, {
      relationGraph: createRelationGraph(db)
    });
    const result = await svc.run({ dryRun: true });
    expect(result.clustersFound).toBeGreaterThanOrEqual(1);
    expect(result.semanticsCreated).toBe(0);
    const semCount = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_item WHERE type = 'semantic'`
    ) as { c: number };
    expect(Number(semCount.c)).toBe(0);
  });

  it('rejects concurrent run with ConsolidationAlreadyRunningError', async () => {
    delete process.env.OPENAI_API_KEY;
    const emb = [1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      insertEpisodic(db, `e${i}`);
      insertEmbedding(db, `e${i}`, emb);
    }
    const { createRelationGraph } = await import(
      '../../../infrastructure/relation-graph-factory.js'
    );
    const slow = new SummarizationService();
    vi.spyOn(slow, 'summarizeCluster').mockImplementation(
      () =>
        new Promise(resolve => {
          setTimeout(() => resolve({ content: 'x', method: 'extractive' as const }), 200);
        })
    );
    const svc = new SleepConsolidationService(db, {
      summarizationService: slow,
      relationGraph: createRelationGraph(db)
    });
    const p1 = svc.run({});
    await expect(svc.run({})).rejects.toMatchObject({ name: 'ConsolidationAlreadyRunningError' });
    await p1;
  });
});
