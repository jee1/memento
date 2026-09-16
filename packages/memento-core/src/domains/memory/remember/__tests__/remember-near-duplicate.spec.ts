import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { handleMemoryItem, type MemoryItemContext } from '../remember-tool-memory-item.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import type { ToolContext } from '../../../../tools/types.js';
import * as configModule from '../../../../shared/config/index.js';
import * as vectorSearchModule from '../../../search/algorithms/vector-search-engine.js';
import {
  findNearDuplicateCandidates,
  lexicalOverlap,
} from '../remember-near-duplicate.js';
import type { RememberParams } from '../remember-tool-schema.js';

const OVERLAPPING_BASE = '프로젝트 memento near-dup 어휘 겹침 테스트 공통 문장 본문';
const OVERLAPPING_VARIANT = `${OVERLAPPING_BASE} 추가 업데이트 내용`;
const TEMPLATE_A = '## 작업 보고\n저장소 memento 이슈 997 phase1 구현 완료 보고서\n결론: 어휘 가드 적용';
const TEMPLATE_B = '## 작업 보고\n저장소 memento 이슈 998 phase2 구현 완료 보고서\n결론: 임베딩 청킹 적용';
const UNRELATED_A = '양자역학 입자 가속기 실험 결과 요약 보고서';
const UNRELATED_B = '고전 음악 바흐 곡별 해석과 연주 스타일 비교';

function initializeTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      origin_source TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL,
      version INTEGER NULL,
      version_series_id TEXT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL,
      project_id TEXT NULL,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
  `);
}

function insertMemory(
  db: Database.Database,
  row: {
    id: string;
    type: string;
    content: string;
    owner_id?: string | null;
    project_id?: string | null;
    importance?: number;
    tags?: string;
    num_times?: number;
    workflow_name?: string;
    skill_name?: string;
    steps?: string;
  },
): void {
  db.prepare(`
    INSERT INTO memory_item (
      id, type, content, importance, owner_id, project_id, tags,
      workflow_name, skill_name, steps, recall_count, num_times
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    row.id,
    row.type,
    row.content,
    row.importance ?? 0.5,
    row.owner_id ?? null,
    row.project_id ?? null,
    row.tags ?? null,
    row.workflow_name ?? null,
    row.skill_name ?? null,
    row.steps ?? null,
    row.num_times ?? 1,
  );
}

function createHost(): RememberToolHost {
  return {
    logInfo: vi.fn(),
    logWarning: vi.fn(),
    logError: vi.fn(),
    createSuccessResult: (data: unknown) => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    }),
    createErrorResult: (error, message, data) => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: { code: error, message: message ?? error },
          ...(data ? { data } : {}),
        }),
      }],
      error,
      ...(message ? { message } : {}),
    }),
  };
}

function baseCtx(type: MemoryItemContext['type'], overrides: Partial<MemoryItemContext> = {}): MemoryItemContext {
  return {
    type,
    ownerId: 'owner-a',
    processId: null,
    sessionId: null,
    numTimes: 1,
    sourceSessionId: null,
    confidenceVal: null,
    origin_source: '{}',
    startTime: Date.now(),
    project_id_param: 'proj-a',
    last_mentioned_at_param: null,
    ...overrides,
  };
}

describe('lexicalOverlap (#997)', () => {
  it('returns 1 for identical strings', () => {
    expect(lexicalOverlap('alpha beta gamma', 'alpha beta gamma')).toBe(1);
  });

  it('returns near 0 for unrelated strings', () => {
    const overlap = lexicalOverlap(UNRELATED_A, UNRELATED_B);
    expect(overlap).toBeLessThan(0.15);
  });

  it('returns 0 when either input is shorter than 3 characters', () => {
    expect(lexicalOverlap('ab', 'abcdef')).toBe(0);
    expect(lexicalOverlap('abcdef', 'xy')).toBe(0);
    expect(lexicalOverlap('a', 'b')).toBe(0);
  });
});

describe('remember near-duplicate write path (#730, #997)', () => {
  let db: Database.Database;
  let context: ToolContext;
  let host: RememberToolHost;
  let searchMock: ReturnType<typeof vi.fn>;
  let configSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    searchMock = vi.fn().mockResolvedValue([]);
    vi.spyOn(vectorSearchModule, 'getVectorSearchEngine').mockReturnValue({
      initialize: vi.fn(),
      search: searchMock,
    } as unknown as vectorSearchModule.VectorSearchEngine);

    configSpy = vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'warn',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    const unifiedEmbedding = {
      generateEmbedding: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      getCurrentProviderName: vi.fn().mockReturnValue('mock'),
    };

    context = {
      db,
      services: {
        embeddingService: {
          isAvailable: () => true,
          getUnifiedEmbeddingService: () => unifiedEmbedding,
        } as ToolContext['services']['embeddingService'],
        vectorSearchEngine: {
          initialize: vi.fn(),
          search: searchMock,
        } as unknown as ToolContext['services']['vectorSearchEngine'],
      },
    };

    host = createHost();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function parsePayload(result: Awaited<ReturnType<typeof handleMemoryItem>>) {
    return JSON.parse(result.content[0].text);
  }

  it('warns on near-duplicate content in same scope', async () => {
    insertMemory(db, {
      id: 'mem_existing',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_existing',
        similarity: 0.92,
        content: OVERLAPPING_BASE,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const params: RememberParams = {
      type: 'semantic',
      content: OVERLAPPING_VARIANT,
    };

    const result = await handleMemoryItem(params, context, baseCtx('semantic'), host);
    const data = parsePayload(result);

    expect(searchMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        owner_id: 'owner-a',
        project_id: 'proj-a',
        threshold: 0.85,
        types: ['semantic'],
      }),
      'mock',
    );

    expect(data.memory_id).not.toBe('mem_existing');
    expect(data.similarity_warning).toMatchObject({
      count: 1,
      similar_ids: ['mem_existing'],
      action: 'warned',
      suggestion: 'incremental',
    });
    expect(data.similarity_warning.candidates[0]).toMatchObject({
      id: 'mem_existing',
      similarity: 0.92,
    });
    expect(data.similarity_warning.candidates[0].lexical_overlap).toBeGreaterThanOrEqual(0.7);

    const count = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(count.c).toBe(2);
  });

  it('removes high-vector low-lexical hits from candidates', async () => {
    insertMemory(db, {
      id: 'mem_unrelated',
      type: 'semantic',
      content: UNRELATED_A,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_unrelated',
        similarity: 0.92,
        content: UNRELATED_A,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: UNRELATED_B },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(lexicalOverlap(UNRELATED_A, UNRELATED_B)).toBeLessThan(0.15);
    expect(data.similarity_warning).toBeUndefined();
  });

  it('incremental with low lexical overlap inserts new row and omits suggestion', async () => {
    insertMemory(db, {
      id: 'mem_template',
      type: 'semantic',
      content: TEMPLATE_A,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_template',
        similarity: 0.92,
        content: TEMPLATE_A,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const overlap = lexicalOverlap(TEMPLATE_A, TEMPLATE_B);
    expect(overlap).toBeGreaterThan(0.3);
    expect(overlap).toBeLessThan(0.7);

    const result = await handleMemoryItem(
      {
        type: 'semantic',
        content: TEMPLATE_B,
        update_mode: 'incremental',
      },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).not.toBe('mem_template');
    expect(data.similarity_warning).toMatchObject({
      action: 'warned',
      count: 1,
    });
    expect(data.similarity_warning.suggestion).toBeUndefined();
    expect(data.similarity_warning.candidates[0].lexical_overlap).toBeLessThan(0.7);

    const count = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(count.c).toBe(2);
  });

  it('does not warn on dissimilar content', async () => {
    searchMock.mockResolvedValue([
      { memory_id: 'mem_other', similarity: 0.4, content: 'unrelated', type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'totally different topic' },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);
    expect(data.similarity_warning).toBeUndefined();
  });

  it('isolates by project_id', async () => {
    insertMemory(db, {
      id: 'mem_other_project',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-b',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_other_project',
        similarity: 0.95,
        content: OVERLAPPING_BASE,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-b',
      },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: OVERLAPPING_VARIANT },
      context,
      baseCtx('semantic', { project_id_param: 'proj-a' }),
      host,
    );
    const data = parsePayload(result);
    expect(data.similarity_warning).toBeUndefined();
  });

  it('isolates by owner_id', async () => {
    insertMemory(db, {
      id: 'mem_other_owner',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-b',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_other_owner',
        similarity: 0.95,
        content: OVERLAPPING_BASE,
        type: 'semantic',
        owner_id: 'owner-b',
        project_id: 'proj-a',
      },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: OVERLAPPING_VARIANT },
      context,
      baseCtx('semantic', { ownerId: 'owner-a' }),
      host,
    );
    const data = parsePayload(result);
    expect(data.similarity_warning).toBeUndefined();
  });

  it('warns for working type', async () => {
    insertMemory(db, {
      id: 'mem_working',
      type: 'working',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_working', similarity: 0.88, content: OVERLAPPING_BASE, type: 'working', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      { type: 'working', content: OVERLAPPING_VARIANT },
      context,
      baseCtx('working'),
      host,
    );
    const data = parsePayload(result);
    expect(data.similarity_warning?.action).toBe('warned');
  });

  it('fail-open when vector search throws', async () => {
    searchMock.mockRejectedValue(new Error('vec down'));

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'content during outage' },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);
    expect(data.memory_id).toBeDefined();
    expect(data.similarity_warning).toBeUndefined();
    expect(host.logWarning).toHaveBeenCalled();
  });

  it('suppresses warn when threshold is high', async () => {
    configSpy.mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'warn',
      rememberDedupThreshold: 0.99,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_low_sim',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_low_sim', similarity: 0.9, content: OVERLAPPING_BASE, type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: OVERLAPPING_VARIANT },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);
    expect(data.similarity_warning).toBeUndefined();
  });

  it('strict mode rejects insert and returns candidates', async () => {
    configSpy.mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'strict',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_strict',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_strict', similarity: 0.91, content: OVERLAPPING_BASE, type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const before = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };

    const result = await handleMemoryItem(
      { type: 'semantic', content: OVERLAPPING_VARIANT },
      context,
      baseCtx('semantic'),
      host,
    );

    expect(result.error).toBe('NEAR_DUPLICATE');
    const payload = parsePayload(result);
    expect(payload.success).toBe(false);
    expect(payload.data.similarity_warning.action).toBe('rejected');
    expect(payload.data.similarity_warning.candidates[0].id).toBe('mem_strict');

    const after = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('off mode skips search and warning', async () => {
    configSpy.mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'off',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_off',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    const result = await handleMemoryItem(
      { type: 'semantic', content: OVERLAPPING_BASE },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);
    expect(searchMock).not.toHaveBeenCalled();
    expect(data.similarity_warning).toBeUndefined();
  });

  it('incremental merges into top candidate without new row', async () => {
    insertMemory(db, {
      id: 'mem_merge',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
      importance: 0.4,
      tags: '["a"]',
      num_times: 2,
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_merge', similarity: 0.93, content: OVERLAPPING_BASE, type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      {
        type: 'semantic',
        content: OVERLAPPING_VARIANT,
        importance: 0.7,
        tags: ['b'],
        update_mode: 'incremental',
      },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).toBe('mem_merge');
    expect(data.similarity_warning?.action).toBe('merged');
    expect(data.similarity_warning?.suggestion).toBe('incremental');
    expect(data.similarity_warning?.candidates[0].lexical_overlap).toBeGreaterThanOrEqual(0.7);

    const row = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', ['mem_merge']) as Record<string, unknown>;
    expect(row.content).toBe(OVERLAPPING_VARIANT);
    expect(row.importance).toBe(0.7);
    expect(JSON.parse(row.tags as string)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(row.num_times).toBe(3);

    const count = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(count.c).toBe(1);
  });

  it('incremental without candidates inserts new row', async () => {
    searchMock.mockResolvedValue([]);

    const result = await handleMemoryItem(
      {
        type: 'episodic',
        content: 'brand new episode',
        update_mode: 'incremental',
      },
      context,
      baseCtx('episodic'),
      host,
    );
    const data = parsePayload(result);
    expect(data.memory_id).toBeDefined();
    expect(data.similarity_warning).toBeUndefined();
  });

  it('procedural incremental hit skips near-dup merge', async () => {
    insertMemory(db, {
      id: 'mem_proc',
      type: 'procedural',
      content: 'proc old',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      workflow_name: 'wf',
      skill_name: 'sk',
      steps: '["step1"]',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_sem', similarity: 0.99, content: 'near dup semantic', type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      {
        type: 'procedural',
        content: 'proc updated',
        workflow_name: 'wf',
        skill_name: 'sk',
        steps: '["step2"]',
        update_mode: 'incremental',
      },
      context,
      baseCtx('procedural'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).toBe('mem_proc');
    expect(searchMock).not.toHaveBeenCalled();
    expect(data.similarity_warning).toBeUndefined();

    const row = DatabaseUtils.get(db, 'SELECT steps FROM memory_item WHERE id = ?', ['mem_proc']) as { steps: string };
    expect(JSON.parse(row.steps)).toEqual(['step1', 'step2']);
  });

  it('sets truncated when vector search returns limit hits', async () => {
    insertMemory(db, {
      id: 'mem_trunc',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    const hits = Array.from({ length: 8 }, (_, index) => ({
      memory_id: index === 0 ? 'mem_trunc' : `mem_extra_${index}`,
      similarity: 0.9 - index * 0.01,
      content: index === 0 ? OVERLAPPING_BASE : UNRELATED_A,
      type: 'semantic',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    }));

    for (let index = 1; index < 8; index++) {
      insertMemory(db, {
        id: `mem_extra_${index}`,
        type: 'semantic',
        content: UNRELATED_A,
        owner_id: 'owner-a',
        project_id: 'proj-a',
      });
    }

    searchMock.mockResolvedValue(hits);

    const result = await handleMemoryItem(
      { type: 'semantic', content: OVERLAPPING_VARIANT },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.similarity_warning?.truncated).toBe(true);
  });

  it('disables lexical gate when floor is 0', async () => {
    configSpy.mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'warn',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_gate_off',
      type: 'semantic',
      content: UNRELATED_A,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_gate_off',
        similarity: 0.92,
        content: UNRELATED_A,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: UNRELATED_B },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.similarity_warning?.count).toBe(1);
    expect(data.similarity_warning?.candidates[0].lexical_overlap).toBeLessThan(0.15);
    expect(data.similarity_warning?.suggestion).toBeUndefined();
  });

  it('drops candidates when content lookup fails', async () => {
    const allSpy = vi.spyOn(DatabaseUtils, 'all').mockImplementation(() => {
      throw new Error('db read failed');
    });

    insertMemory(db, {
      id: 'mem_lookup_fail',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_lookup_fail',
        similarity: 0.92,
        content: OVERLAPPING_BASE,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const result = await findNearDuplicateCandidates(
      db,
      OVERLAPPING_VARIANT,
      { type: 'semantic', ownerId: 'owner-a', projectId: 'proj-a' },
      0.85,
      context,
      host,
    );

    expect(result.candidates).toEqual([]);
    expect(host.logWarning).toHaveBeenCalledWith(
      'near-dup candidate content lookup failed (fail-open)',
      expect.objectContaining({ candidate_count: 1 }),
    );

    allSpy.mockRestore();
  });
});
