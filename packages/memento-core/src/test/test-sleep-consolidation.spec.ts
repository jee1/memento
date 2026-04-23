/**
 * Sleep consolidation 시나리오 (SC-001, SC-003, SC-004, SC-005 요약 검증)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@memento/core/infrastructure/database/database/init.js';
import { initializeServices } from '../bootstrap.js';
import type { ServerServices } from '../bootstrap.js';
import { cleanupTestDatabase, createTestMemory } from './helpers/test-database.js';
import { insertMemoryEmbedding } from './helpers/consolidation-test-data.js';
import { DatabaseUtils } from '@memento/core/shared/utils/database.js';

describe('test-sleep-consolidation', () => {
  let db: Database.Database;
  let services: ServerServices;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    db = await initializeDatabase(':memory:');
    services = await initializeServices(db);
  });

  afterEach(async () => {
    try {
      await services.batchScheduler?.stop();
    } catch {
      /* ignore */
    }
    await cleanupTestDatabase(db);
  });

  function seedCluster(
    count: number,
    vec: number[],
    opts?: { pinned?: boolean; keyword?: string; idPrefix?: string }
  ) {
    const kw = opts?.keyword ?? 'shared-keyword';
    const prefix = opts?.idPrefix ?? `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    for (let i = 0; i < count; i++) {
      const id = `${prefix}_${i}`;
      createTestMemory(db, {
        id,
        type: 'episodic',
        content: `${kw} note ${i}`,
        importance: Math.min(0.99, 0.5 + i * 0.004),
        pinned: opts?.pinned ?? false
      });
      insertMemoryEmbedding(db, {
        memory_id: id,
        embedding: vec,
        embedding_provider: 'minilm',
        dim: vec.length
      });
    }
  }

  it('SC-001/SC-003: 동일 주제 에피소딕 클러스터 후 시맨틱 생성 및 핵심 키워드 보존(extractive)', async () => {
    const vec = new Array(384).fill(0);
    vec[0] = 1;
    seedCluster(10, vec, { keyword: 'alpha-topic' });
    const before = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_item WHERE type = 'episodic' AND COALESCE(is_consolidated,0)=0`
    ) as { c: number };
    expect(Number(before.c)).toBe(10);

    const result = await services.sleepConsolidationService!.run({});
    expect(result.semanticsCreated).toBeGreaterThanOrEqual(1);
    expect(result.episodicsConsolidated).toBeGreaterThanOrEqual(10);

    const after = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_item WHERE type = 'episodic' AND COALESCE(is_consolidated,0)=0`
    ) as { c: number };
    expect(Number(after.c)).toBeLessThanOrEqual(Number(before.c) * 0.6);

    const sem = DatabaseUtils.get(
      db,
      `SELECT content FROM memory_item WHERE type = 'semantic' ORDER BY created_at DESC LIMIT 1`
    ) as { content: string };
    expect(sem.content).toContain('alpha-topic');
  });

  it('SC-005: 핀된 에피소딕은 통합 후에도 미통합 상태 유지', async () => {
    const vec = new Array(384).fill(0);
    vec[1] = 1;
    seedCluster(5, vec, { idPrefix: 'sc5_u' });
    seedCluster(5, vec, { pinned: true, idPrefix: 'sc5_p' });
    await services.sleepConsolidationService!.run({});

    const pinnedPending = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_item WHERE type='episodic' AND pinned=1 AND COALESCE(is_consolidated,0)=0`
    ) as { c: number };
    expect(Number(pinnedPending.c)).toBe(5);
  });

  it('에지: 전부 핀된 에피소딕만 있으면 시맨틱이 생성되지 않음', async () => {
    const vec = new Array(384).fill(0);
    vec[3] = 1;
    seedCluster(10, vec, { pinned: true });
    const result = await services.sleepConsolidationService!.run({});
    expect(result.semanticsCreated).toBe(0);
    expect(result.clustersFound).toBe(0);
  });

  it('SC-004: 에피소딕 500개 기준 배치가 120초 이내 완료', async () => {
    const vec = new Array(384).fill(0);
    vec[2] = 1;
    const n = 500;
    seedCluster(n, vec);
    const t0 = Date.now();
    await services.sleepConsolidationService!.run({});
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(120_000);
  }, 300_000);
});
