/**
 * buildKnowledgeContextBundle 단위·통합 검증 (#232, #811 US2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { createHybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import type { HybridSearchEngine, HybridSearchResult } from '../../../search/algorithms/hybrid-search-engine.js';
import { ErrorLoggingService } from '../../../monitoring/services/error-logging-service.js';
import type { ToolContext } from '../../../tools/types.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { buildKnowledgeContextBundle } from '../knowledge-context-bundle-builder.js';
import { ToolContextKnowledgeContextAdapter } from '../../../personal-agent/adapters/tool-context-knowledge-context-adapter.js';

function stubSearchHit(
  overrides: Pick<HybridSearchResult, 'id' | 'content'> & Partial<HybridSearchResult>,
): HybridSearchResult {
  return {
    type: 'semantic',
    importance: 0.9,
    created_at: '2026-01-01T00:00:00.000Z',
    pinned: false,
    textScore: 1,
    vectorScore: 0,
    finalScore: 1,
    recall_reason: 'stub',
    ...overrides,
  };
}

describe('buildKnowledgeContextBundle', () => {
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    db = await setupTestDatabase();
    const errorLoggingService = new ErrorLoggingService(db);
    const embeddingService = new MemoryEmbeddingService();
    const hybridSearchEngine = createHybridSearchEngine(undefined, embeddingService);
    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        errorLoggingService,
      },
    };
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it('projectId가 지정되면 해당 프로젝트 기억만 번들에 포함한다', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
      VALUES
        ('ctx_mine', 'semantic', 'ctx-proj-a 전용 내용', 0.9, 'proj-a', datetime('now')),
        ('ctx_other', 'semantic', 'ctx-proj-b 다른 내용', 0.9, 'proj-b', datetime('now'))
    `);

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: context.services!.hybridSearchEngine!,
      },
      { query: 'ctx-proj', projectId: 'proj-a', maxMemories: 5, tokenBudget: 2000 },
    );

    expect(bundle.promptText).toContain('ctx-proj-a 전용');
    expect(bundle.promptText).not.toContain('ctx-proj-b');
    expect(bundle.itemCount).toBeGreaterThanOrEqual(1);
    expect(bundle.contextSummary).toContain('관련 기억');
  });

  it('ownerId가 지정되면 해당 소유자 기억만 포함한다', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, owner_id, created_at)
      VALUES
        ('ctx_own_a', 'episodic', 'owner-scope 알파 내용', 0.9, 'agent-a', datetime('now')),
        ('ctx_own_b', 'episodic', 'owner-scope 베타 내용', 0.9, 'agent-b', datetime('now'))
    `);

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: context.services!.hybridSearchEngine!,
      },
      { query: 'owner-scope', ownerId: 'agent-a', maxMemories: 5, tokenBudget: 2000 },
    );

    expect(bundle.promptText).toContain('알파');
    expect(bundle.promptText).not.toContain('베타');
  });

  it('옛 triple 템플릿이 남긴 이중 활용 문장은 주입에서 제외한다 (#768)', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, created_at)
      VALUES
        ('ctx_broken', 'semantic', 'injectfilter 인터페이스는 모든 타입를 정의됨합니다', 0.9, datetime('now')),
        ('ctx_clean', 'semantic', 'injectfilter 인터페이스는 모든 타입을 정의합니다', 0.9, datetime('now'))
    `);

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: context.services!.hybridSearchEngine!,
      },
      { query: 'injectfilter', maxMemories: 5, tokenBudget: 2000 },
    );

    expect(bundle.promptText).toContain('정의합니다');
    expect(bundle.promptText).not.toContain('정의됨합니다');
  });

  it('손상 비율이 높아도 adaptive overfetch로 maxMemories를 정상 후보로 채운다 (#811 US2)', async () => {
    const maxMemories = 5;
    const broken = Array.from({ length: 40 }, (_, i) =>
      stubSearchHit({
        id: `broken_${i}`,
        content: `adaptivefill 주제${i}는 객체를 정의됨합니다`,
        finalScore: 1 - i * 0.001,
      }),
    );
    const clean = [
      stubSearchHit({
        id: 'clean_포함',
        content: 'adaptivefill 시스템은 기능을 포함합니다',
        finalScore: 0.4,
      }),
      stubSearchHit({
        id: 'clean_1',
        content: 'adaptivefill 주제는 객체를 정의합니다',
        finalScore: 0.39,
      }),
      stubSearchHit({
        id: 'clean_2',
        content: 'adaptivefill 모듈은 계약을 구현합니다',
        finalScore: 0.38,
      }),
      stubSearchHit({
        id: 'clean_3',
        content: 'adaptivefill 서비스는 상태를 저장합니다',
        finalScore: 0.37,
      }),
      stubSearchHit({
        id: 'clean_4',
        content: 'adaptivefill 파이프라인은 결과를 반환합니다',
        finalScore: 0.36,
      }),
      // #781: 함합니다는 탐지 확장이 아니므로 통과해야 한다 (예산 밖이면 제외될 수 있음)
      stubSearchHit({
        id: 'hamham',
        content: 'adaptivefill 시스템는 완료를 구현함합니다',
        finalScore: 0.35,
      }),
    ];
    const ranked = [...broken, ...clean];

    const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => {
      const limit = query.limit ?? 10;
      return {
        items: ranked.slice(0, limit),
        total_count: ranked.length,
        query_time: 1,
        union_count: ranked.length,
        reranked_count: Math.min(limit, ranked.length),
      };
    });

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: { search } as unknown as HybridSearchEngine,
      },
      { query: 'adaptivefill', maxMemories, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(maxMemories);
    expect(bundle.promptText).not.toMatch(/정의됨합니다/);
    expect(bundle.promptText).toContain('포함합니다');
    // 고정 *2 shortlist(limit=10)만이면 전부 손상이라 0건 — adaptive면 limit이 커져야 함
    const limits = search.mock.calls.map(([, q]) => (q as { limit?: number }).limit ?? 10);
    expect(Math.max(...limits)).toBeGreaterThan(maxMemories * 2);
  });

  it('포함합니다·함합니다는 기존 정책대로 주입에서 제외하지 않는다 (#781 / #811 FR-004)', async () => {
    const search = vi.fn(async () => ({
      items: [
        stubSearchHit({
          id: 'ok_포함',
          content: 'policycheck 시스템은 기능을 포함합니다',
          finalScore: 0.9,
        }),
        stubSearchHit({
          id: 'ok_함합니다',
          content: 'policycheck 시스템는 완료를 구현함합니다',
          finalScore: 0.8,
        }),
      ],
      total_count: 2,
      query_time: 1,
      union_count: 2,
      reranked_count: 2,
    }));

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: { search } as unknown as HybridSearchEngine,
      },
      { query: 'policycheck', maxMemories: 5, tokenBudget: 2000 },
    );

    expect(bundle.itemCount).toBe(2);
    expect(bundle.promptText).toContain('포함합니다');
    expect(bundle.promptText).toContain('구현함합니다');
  });

  it('후보가 전부 손상이면 빈 번들을 반환하고 throw하지 않는다 (#811 US2)', async () => {
    const brokenOnly = Array.from({ length: 12 }, (_, i) =>
      stubSearchHit({
        id: `all_broken_${i}`,
        content: `allcorrupt 주제${i}는 규칙을 정의됨합니다`,
        finalScore: 1 - i * 0.01,
      }),
    );
    const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => {
      const limit = query.limit ?? 10;
      return {
        items: brokenOnly.slice(0, limit),
        total_count: brokenOnly.length,
        query_time: 1,
        union_count: brokenOnly.length,
        reranked_count: Math.min(limit, brokenOnly.length),
      };
    });

    await expect(
      buildKnowledgeContextBundle(
        {
          db,
          hybridSearchEngine: { search } as unknown as HybridSearchEngine,
        },
        { query: 'allcorrupt', maxMemories: 5, tokenBudget: 2000 },
      ),
    ).resolves.toMatchObject({
      itemCount: 0,
      promptText: '관련 기억을 찾을 수 없습니다.',
    });
  });
});

describe('ToolContextKnowledgeContextAdapter', () => {
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    db = await setupTestDatabase();
    const errorLoggingService = new ErrorLoggingService(db);
    const embeddingService = new MemoryEmbeddingService();
    const hybridSearchEngine = createHybridSearchEngine(undefined, embeddingService);
    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        errorLoggingService,
      },
    };
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it('buildContext가 번들을 반환한다', async () => {
    const adapter = new ToolContextKnowledgeContextAdapter(context);
    const bundle = await adapter.buildContext({ userMessage: '아무 검색어' });
    expect(bundle.promptText).toBeDefined();
    expect(typeof bundle.itemCount).toBe('number');
    expect(typeof bundle.tokenEstimate).toBe('number');
    expect(bundle.contextSummary).toBeDefined();
  });
});
