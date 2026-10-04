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

function stubEngine(ranked: HybridSearchResult[]): HybridSearchEngine {
  const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => ({
    items: ranked.slice(0, query.limit ?? 10),
    total_count: ranked.length,
    query_time: 1,
    union_count: ranked.length,
    reranked_count: ranked.length,
  }));
  return { search } as unknown as HybridSearchEngine;
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

  it('옛 triple 템플릿 손상 문장도 dedupe만 적용하고 주입한다 (#1237)', async () => {
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

    expect(bundle.itemCount).toBeGreaterThan(0);
    expect(bundle.promptText).toMatch(/정의(합니다|됨합니다)/);
  });

  it('adaptive overfetch 없이도 상위 후보로 maxMemories를 채운다 (#1237)', async () => {
    const maxMemories = 5;
    const ranked = Array.from({ length: 12 }, (_, i) =>
      stubSearchHit({
        id: `candidate_${i}`,
        content: `adaptivefill 주제${i}는 객체를 정의됨합니다`,
        finalScore: 1 - i * 0.01,
      }),
    );

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
    expect(bundle.promptText).toMatch(/정의됨합니다/);
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

  it('후보가 전부 손상 문장이어도 번들을 반환하고 throw하지 않는다 (#1237)', async () => {
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

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: { search } as unknown as HybridSearchEngine,
      },
      { query: 'allcorrupt', maxMemories: 5, tokenBudget: 2000 },
    );

    expect(bundle.itemCount).toBe(5);
    expect(bundle.promptText).toMatch(/정의됨합니다/);
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

describe('buildKnowledgeContextBundle content 중복 제거 (#1137)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it('같은 본문 사본이 예산을 먹지 않는다 (SC-003)', async () => {
    const duplicateBody = 'dedupe 대상 원문: LLM provider 라우팅을 정리하고 4잡 override 대칭을 맞췄다';
    const copies = Array.from({ length: 5 }, (_, i) =>
      stubSearchHit({
        id: `dup_${i}`,
        content: duplicateBody,
        finalScore: 1 - i * 0.01,
      }),
    );
    const distinct = stubSearchHit({
      id: 'distinct_1',
      content: 'dedupe 별개 기억: 검색 랭킹 가중치를 조정했다',
      finalScore: 0.5,
    });

    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: stubEngine([...copies, distinct]) },
      { query: 'dedupe', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(2);
    expect(bundle.promptText).toContain('dedupe 별개 기억');
    expect(bundle.promptText.split(duplicateBody).length - 1).toBe(1);
  });

  it('500자로 잘린 사본과 원문 행을 같은 중복으로 본다', async () => {
    const full = `잘림 판정 원문 ${'가'.repeat(700)}`;
    const truncated = `${full.slice(0, 500)}…`;

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: stubEngine([
          stubSearchHit({ id: 'trunc_copy', content: truncated, type: 'semantic', finalScore: 0.9 }),
          stubSearchHit({ id: 'full_origin', content: full, type: 'episodic', finalScore: 0.8 }),
        ]),
      },
      { query: '잘림 판정', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(1);
  });

  it('앞부분이 달라지면 별개 기억으로 남긴다', async () => {
    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: stubEngine([
          stubSearchHit({ id: 'sep_1', content: '별개 판정 첫 번째 기억 본문', finalScore: 0.9 }),
          stubSearchHit({ id: 'sep_2', content: '별개 판정 두 번째 기억 본문', finalScore: 0.8 }),
        ]),
      },
      { query: '별개 판정', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(2);
  });

  it('중복 그룹에서 finalScore가 가장 높은 행을 남긴다', async () => {
    const body = '대표 선택 판정용 동일 본문';

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: stubEngine([
          stubSearchHit({ id: 'low', content: body, finalScore: 0.2, importance: 0.2 }),
          stubSearchHit({ id: 'high', content: body, finalScore: 0.9, importance: 0.9 }),
        ]),
      },
      { query: '대표 선택', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(1);
    expect(bundle.topMemoryId).toBe('high');
  });
});

describe('buildKnowledgeContextBundle 순위 출처 (#1177)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  /** finalScore 와 importance 가 서로 반대인 후보 — raw importance 를 더하면 순서가 뒤집힌다. */
  const engineTop = () =>
    stubSearchHit({
      id: 'score_high',
      content: '순위 출처 판정: 엔진 점수가 높은 기억',
      finalScore: 0.9,
      importance: 0.1,
    });
  const importanceTop = () =>
    stubSearchHit({
      id: 'importance_high',
      content: '순위 출처 판정: 중요도만 높은 기억',
      finalScore: 0.5,
      importance: 0.9,
    });

  it('엔진 순위를 그대로 쓴다 — raw importance 로 재정렬하지 않는다', async () => {
    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: stubEngine([engineTop(), importanceTop()]) },
      { query: '순위 출처', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(2);
    expect(bundle.topMemoryId).toBe('score_high');
    expect(bundle.promptText.indexOf('엔진 점수가 높은 기억')).toBeLessThan(
      bundle.promptText.indexOf('중요도만 높은 기억'),
    );
  });

  it('maxMemories 로 잘릴 때 엔진 상위가 남는다', async () => {
    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: stubEngine([engineTop(), importanceTop()]) },
      { query: '순위 출처', maxMemories: 1, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(1);
    expect(bundle.topMemoryId).toBe('score_high');
    expect(bundle.promptText).not.toContain('중요도만 높은 기억');
  });

  it('중복 대표도 finalScore 로 고른다 — importance 가 높은 사본을 남기지 않는다', async () => {
    const body = '중복 대표 판정용 동일 본문';

    const bundle = await buildKnowledgeContextBundle(
      {
        db,
        hybridSearchEngine: stubEngine([
          stubSearchHit({ id: 'importance_high', content: body, finalScore: 0.5, importance: 0.9 }),
          stubSearchHit({ id: 'score_high', content: body, finalScore: 0.9, importance: 0.1 }),
        ]),
      },
      { query: '중복 대표', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(1);
    expect(bundle.topMemoryId).toBe('score_high');
  });
});
