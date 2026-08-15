/**
 * buildKnowledgeContextBundle 단위·통합 검증 (#232)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { createHybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { ErrorLoggingService } from '../../../monitoring/services/error-logging-service.js';
import type { ToolContext } from '../../../tools/types.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { buildKnowledgeContextBundle } from '../knowledge-context-bundle-builder.js';
import { ToolContextKnowledgeContextAdapter } from '../../../personal-agent/adapters/tool-context-knowledge-context-adapter.js';

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
