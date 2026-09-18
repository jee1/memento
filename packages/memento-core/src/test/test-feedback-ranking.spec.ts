/**
 * T033: recall → 긍정 피드백 다건 → 재 recall 시 해당 기억 순위 상승(텍스트 검색·피드백 가중 프로파일)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@memento/core/infrastructure/database/sqlite/init.js';
import { initializeServices } from '../bootstrap.js';
import type { ServerServices } from '../bootstrap.js';
import { RecallTool } from '@memento/core/domains/memory/recall/recall-tool.js';
import { FeedbackRepositorySQLite as FeedbackRepository } from '@memento/core/infrastructure/database/repositories/feedback-repository-sqlite.impl.js';
import { resetRankingWeightsCache } from '@memento/core/shared/config/ranking-weights-loader.js';
import { cleanupTestDatabase, createTestMemory } from './helpers/test-database.js';
import { insertMemoryEmbedding } from './helpers/consolidation-test-data.js';

describe('test-feedback-ranking (T033)', () => {
  let db: Database.Database;
  let services: ServerServices;
  const savedEnv = process.env.MEMENTO_RANKING_WEIGHTS_PATH;

  beforeAll(() => {
    const candidates = [
      join(process.cwd(), 'config/ranking-profiles/feedback-heavy.toml'),
      join(process.cwd(), '../config/ranking-profiles/feedback-heavy.toml'),
    ];
    const profile = candidates.find((p) => existsSync(p));
    if (!profile) {
      throw new Error(`missing ranking profile (tried: ${candidates.join(', ')})`);
    }
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = profile;
    resetRankingWeightsCache();
  });

  afterAll(() => {
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = savedEnv;
    resetRankingWeightsCache();
  });

  beforeEach(async () => {
    resetRankingWeightsCache();
    db = await initializeDatabase(':memory:');
    services = await initializeServices(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it(
    '동일 본문 두 기억 중 피드백을 받은 쪽이 재검색에서 더 높은 순위에 온다',
    async () => {
      const content = 'feedback ranking tie phrase xyz';
      createTestMemory(db, { id: 'mem_rank_a', content, type: 'semantic' });
      createTestMemory(db, { id: 'mem_rank_b', content, type: 'semantic' });
      const tieEmb = new Array(384).fill(0.02);
      insertMemoryEmbedding(db, {
        memory_id: 'mem_rank_a',
        embedding: tieEmb,
        embedding_provider: 'minilm',
        dim: 384,
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem_rank_b',
        embedding: tieEmb,
        embedding_provider: 'minilm',
        dim: 384,
      });

      // created_at 이 이 테스트의 랭킹 순서를 결정한다.
      // 본문이 같으면 fts_rank 가 동점이라 search-engine-sql-builder.ts:125 의
      // `ORDER BY fts_rank ASC, m.created_at DESC` 가 순서를 정하고,
      // 나중에 처리되는 행만 MMR 중복 페널티(search-engine-ranking.ts:115)를 받는다.
      // createTestMemory 는 created_at 을 받지 않아 DEFAULT(#1007 이후 밀리초 정밀도)에 맡기므로,
      // 고정하지 않으면 두 INSERT 가 밀리초 경계를 넘는지에 따라 순서가 뒤집힌다.
      const baseTs = Date.now();
      const setCreatedAt = (id: string, ms: number) =>
        db
          .prepare('UPDATE memory_item SET created_at = ? WHERE id = ?')
          .run(new Date(ms).toISOString(), id);
      setCreatedAt('mem_rank_a', baseTs);     // 더 최근 → 1등, 중복 페널티 없음
      setCreatedAt('mem_rank_b', baseTs - 1); // 2등 → 중복 페널티를 받는 쪽

      const tool = new RecallTool();
      const context = {
        db,
        services: {
          searchEngine: services.searchEngine,
          hybridSearchEngine: services.hybridSearchEngine,
          embeddingService: services.embeddingService,
          anchorManager: services.anchorManager,
        },
      };

      const parseItems = (text: string) => {
        const data = JSON.parse(text) as { items?: Array<{ memory_id?: string; id?: string }> };
        return data.items ?? [];
      };

      const q = {
        query: 'feedback ranking tie phrase',
        type: 'semantic' as const,
        limit: 5,
      };

      const r1 = await tool.handle(q, context);
      const items1 = parseItems(r1.content[0]?.text ?? '{}');
      const idxA1 = items1.findIndex((i) => (i.memory_id ?? i.id) === 'mem_rank_a');
      const idxB1 = items1.findIndex((i) => (i.memory_id ?? i.id) === 'mem_rank_b');

      const repo = new FeedbackRepository(db);
      for (let i = 0; i < 30; i++) {
        repo.insertFeedback({ memory_id: 'mem_rank_b', event: 'helpful' });
      }

      const r2 = await tool.handle(q, context);
      const items2 = parseItems(r2.content[0]?.text ?? '{}');
      const idxA2 = items2.findIndex((i) => (i.memory_id ?? i.id) === 'mem_rank_a');
      const idxB2 = items2.findIndex((i) => (i.memory_id ?? i.id) === 'mem_rank_b');

      // 픽스처가 순서를 고정하므로 결정적이다.
      // idxB1 을 먼저 확인해야, 픽스처가 다시 깨졌을 때
      // `expected 0 to be less than 0` 대신 원인이 드러나는 실패 메시지가 나온다.
      expect(idxB1).toBe(1);
      expect(idxB2).toBe(0);
      expect(idxA2).toBe(1);
    },
    60_000
  );
});
