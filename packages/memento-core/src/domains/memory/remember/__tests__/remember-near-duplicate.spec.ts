import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { handleMemoryItem, type MemoryItemContext } from '../remember-tool-memory-item.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import type { ToolContext } from '../../../../tools/types.js';
import * as configModule from '../../../../shared/config/index.js';
import * as vectorSearchModule from '../../../search/algorithms/vector-search-engine.js';
import type { RememberParams } from '../remember-tool-schema.js';

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

describe('remember near-duplicate write path (#730)', () => {
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
      content: 'alpha beta gamma',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_existing',
        similarity: 0.92,
        content: 'alpha beta gamma',
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const params: RememberParams = {
      type: 'semantic',
      content: 'alpha beta gamma similar',
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
    expect(data.similarity_warning.candidates[0]).toMatchObject({ id: 'mem_existing', similarity: 0.92 });

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
      content: 'shared content',
      owner_id: 'owner-a',
      project_id: 'proj-b',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_other_project',
        similarity: 0.95,
        content: 'shared content',
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-b',
      },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'shared content' },
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
      content: 'shared content',
      owner_id: 'owner-b',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_other_owner',
        similarity: 0.95,
        content: 'shared content',
        type: 'semantic',
        owner_id: 'owner-b',
        project_id: 'proj-a',
      },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'shared content' },
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
      content: 'short task context',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_working', similarity: 0.88, content: 'short task context', type: 'working', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      { type: 'working', content: 'short task context v2' },
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
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_low_sim',
      type: 'semantic',
      content: 'similar-ish',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_low_sim', similarity: 0.9, content: 'similar-ish', type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'similar-ish v2' },
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
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_strict',
      type: 'semantic',
      content: 'dup content',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_strict', similarity: 0.91, content: 'dup content', type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const before = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'dup content again' },
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
      consolidationScoreEnabled: false,
    });

    insertMemory(db, {
      id: 'mem_off',
      type: 'semantic',
      content: 'same',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    const result = await handleMemoryItem(
      { type: 'semantic', content: 'same' },
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
      content: 'old content',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      importance: 0.4,
      tags: '["a"]',
      num_times: 2,
    });

    searchMock.mockResolvedValue([
      { memory_id: 'mem_merge', similarity: 0.93, content: 'old content', type: 'semantic', owner_id: 'owner-a', project_id: 'proj-a' },
    ]);

    const result = await handleMemoryItem(
      {
        type: 'semantic',
        content: 'new merged content',
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

    const row = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', ['mem_merge']) as Record<string, unknown>;
    expect(row.content).toBe('new merged content');
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
});
