import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { ToolInputValidationError } from '../../../../shared/errors/tool-input-validation-error.js';
import { handleMemoryItem, type MemoryItemContext } from '../remember-tool-memory-item.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import type { ToolContext } from '../../../../tools/types.js';
import * as configModule from '../../../../shared/config/index.js';
import * as vectorSearchModule from '../../../search/algorithms/vector-search-engine.js';
import * as dbHelpers from '../remember-tool-db-helpers.js';
import { toDbRelationType } from '../../../../shared/utils/relation-type-converter.js';

const OVERLAPPING_BASE = '명시 타깃 near-dup 스킵 테스트 공통 문장 본문';
const OVERLAPPING_VARIANT = `${OVERLAPPING_BASE} 추가 내용`;

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

    CREATE TABLE IF NOT EXISTS memory_link (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation_type)
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

describe('remember explicit memory_id target (#1000)', () => {
  let db: Database.Database;
  let context: ToolContext;
  let host: RememberToolHost;
  let searchMock: ReturnType<typeof vi.fn>;
  let generateEmbeddingMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    searchMock = vi.fn().mockResolvedValue([]);
    generateEmbeddingMock = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });

    vi.spyOn(vectorSearchModule, 'getVectorSearchEngine').mockReturnValue({
      initialize: vi.fn(),
      search: searchMock,
    } as unknown as vectorSearchModule.VectorSearchEngine);

    vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'warn',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    context = {
      db,
      services: {
        embeddingService: {
          isAvailable: () => true,
          getUnifiedEmbeddingService: () => ({
            generateEmbedding: generateEmbeddingMock,
            getCurrentProviderName: vi.fn().mockReturnValue('mock'),
          }),
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

  it('memory_id + replace는 같은 id로 갱신하고 updated=true를 반환한다', async () => {
    insertMemory(db, {
      id: 'mem_ep_1',
      type: 'episodic',
      content: '원본 내용',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    const result = await handleMemoryItem(
      {
        type: 'episodic',
        content: '교체된 내용',
        memory_id: 'mem_ep_1',
        update_mode: 'replace',
      },
      context,
      baseCtx('episodic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).toBe('mem_ep_1');
    expect(data.updated).toBe(true);
    expect(data.message).toContain('갱신');

    const row = DatabaseUtils.get(db, 'SELECT content FROM memory_item WHERE id = ?', ['mem_ep_1']) as { content: string };
    expect(row.content).toBe('교체된 내용');

    const count = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(count.c).toBe(1);
  });

  it('memory_id + incremental (episodic)는 tags 합집합과 importance 최댓값을 적용한다', async () => {
    insertMemory(db, {
      id: 'mem_ep_inc',
      type: 'episodic',
      content: '에피소드 원본',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      importance: 0.6,
      tags: '["old"]',
    });

    const result = await handleMemoryItem(
      {
        type: 'episodic',
        content: '에피소드 병합',
        memory_id: 'mem_ep_inc',
        update_mode: 'incremental',
        importance: 0.4,
        tags: ['new'],
      },
      context,
      baseCtx('episodic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).toBe('mem_ep_inc');
    expect(data.updated).toBe(true);

    const row = DatabaseUtils.get(db, 'SELECT importance, tags FROM memory_item WHERE id = ?', ['mem_ep_inc']) as {
      importance: number;
      tags: string;
    };
    expect(row.importance).toBe(0.6);
    expect(JSON.parse(row.tags)).toEqual(expect.arrayContaining(['old', 'new']));
  });

  it('memory_id + incremental (semantic)는 num_times를 1 증가시킨다', async () => {
    insertMemory(db, {
      id: 'mem_sem_inc',
      type: 'semantic',
      content: '시맨틱 원본',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      num_times: 3,
    });

    await handleMemoryItem(
      {
        type: 'semantic',
        content: '시맨틱 병합',
        memory_id: 'mem_sem_inc',
        update_mode: 'incremental',
      },
      context,
      baseCtx('semantic'),
      host,
    );

    const row = DatabaseUtils.get(db, 'SELECT num_times FROM memory_item WHERE id = ?', ['mem_sem_inc']) as { num_times: number };
    expect(row.num_times).toBe(4);
  });

  it('memory_id + versioned는 새 memory_id와 VERSION_OF 링크를 만든다', async () => {
    insertMemory(db, {
      id: 'mem_ver_base',
      type: 'episodic',
      content: '버전 원본',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    const result = await handleMemoryItem(
      {
        type: 'episodic',
        content: '버전 신규',
        memory_id: 'mem_ver_base',
        update_mode: 'versioned',
      },
      context,
      baseCtx('episodic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).not.toBe('mem_ver_base');
    expect(data.updated).toBeUndefined();

    const count = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(count.c).toBe(2);

    const link = DatabaseUtils.get(db, `
      SELECT * FROM memory_link
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [data.memory_id, 'mem_ver_base', toDbRelationType('VERSION_OF')]) as Record<string, unknown> | undefined;
    expect(link).toBeDefined();
  });

  it('memory_id만 있고 update_mode가 없으면 ToolInputValidationError', async () => {
    insertMemory(db, {
      id: 'mem_no_mode',
      type: 'episodic',
      content: '대상',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    await expect(handleMemoryItem(
      { type: 'episodic', content: 'x', memory_id: 'mem_no_mode' },
      context,
      baseCtx('episodic'),
      host,
    )).rejects.toThrow(ToolInputValidationError);
  });

  it('존재하지 않는 memory_id는 ToolInputValidationError이고 새 행이 생기지 않는다', async () => {
    const before = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };

    await expect(handleMemoryItem(
      {
        type: 'episodic',
        content: 'x',
        memory_id: 'mem_missing',
        update_mode: 'replace',
      },
      context,
      baseCtx('episodic'),
      host,
    )).rejects.toThrow(/memory_id를 찾을 수 없습니다/);

    const after = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('다른 owner_id 소유 memory_id는 ToolInputValidationError이고 대상 행이 변경되지 않는다', async () => {
    insertMemory(db, {
      id: 'mem_other_owner',
      type: 'episodic',
      content: '비밀 owner-b 전용 내용',
      owner_id: 'owner-b',
      project_id: 'proj-a',
    });

    try {
      await handleMemoryItem(
        {
          type: 'episodic',
          content: '침입 시도',
          memory_id: 'mem_other_owner',
          update_mode: 'replace',
        },
        context,
        baseCtx('episodic', { ownerId: 'owner-a' }),
        host,
      );
      expect.fail('ToolInputValidationError가 발생해야 합니다');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolInputValidationError);
      expect((error as Error).message).toBe('memory_id에 접근할 수 없습니다: mem_other_owner');
      expect((error as Error).message).not.toContain('비밀');
    }

    const row = DatabaseUtils.get(db, 'SELECT content FROM memory_item WHERE id = ?', ['mem_other_owner']) as { content: string };
    expect(row.content).toBe('비밀 owner-b 전용 내용');
  });

  it('다른 project_id의 memory_id는 ToolInputValidationError이고 대상 행이 변경되지 않는다', async () => {
    insertMemory(db, {
      id: 'mem_other_project',
      type: 'episodic',
      content: '비밀 proj-b 전용 내용',
      owner_id: 'owner-a',
      project_id: 'proj-b',
    });

    const before = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };

    try {
      await handleMemoryItem(
        {
          type: 'episodic',
          content: '침입 시도',
          memory_id: 'mem_other_project',
          update_mode: 'replace',
        },
        context,
        baseCtx('episodic'),
        host,
      );
      expect.fail('ToolInputValidationError가 발생해야 합니다');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolInputValidationError);
      expect((error as Error).message).toBe('memory_id의 project_id가 요청과 다릅니다: mem_other_project');
      expect((error as Error).message).not.toContain('비밀');
    }

    const row = DatabaseUtils.get(db, 'SELECT content FROM memory_item WHERE id = ?', ['mem_other_project']) as { content: string };
    expect(row.content).toBe('비밀 proj-b 전용 내용');

    const after = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('type이 다른 memory_id는 ToolInputValidationError', async () => {
    insertMemory(db, {
      id: 'mem_sem_only',
      type: 'semantic',
      content: 'semantic only',
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    await expect(handleMemoryItem(
      {
        type: 'episodic',
        content: 'x',
        memory_id: 'mem_sem_only',
        update_mode: 'replace',
      },
      context,
      baseCtx('episodic'),
      host,
    )).rejects.toThrow(/type\(semantic\)이 요청 type\(episodic\)과 다릅니다/);
  });

  it('명시 타깃이 있으면 near-dup 탐색을 실행하지 않는다', async () => {
    insertMemory(db, {
      id: 'mem_explicit',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    insertMemory(db, {
      id: 'mem_similar',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_similar',
        similarity: 0.95,
        content: OVERLAPPING_BASE,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const result = await handleMemoryItem(
      {
        type: 'semantic',
        content: OVERLAPPING_VARIANT,
        memory_id: 'mem_explicit',
        update_mode: 'replace',
      },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(generateEmbeddingMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
    expect(data.similarity_warning).toBeUndefined();
    expect(data.memory_id).toBe('mem_explicit');
  });

  it('procedural + memory_id는 findExistingProceduralMemory 없이 지정 id를 갱신한다', async () => {
    insertMemory(db, {
      id: 'mem_proc_target',
      type: 'procedural',
      content: 'proc old',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      workflow_name: 'wf-a',
      skill_name: 'sk-a',
      steps: '["s1"]',
    });

    insertMemory(db, {
      id: 'mem_proc_other',
      type: 'procedural',
      content: 'proc other',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      workflow_name: 'wf-a',
      skill_name: 'sk-a',
      steps: '["other"]',
    });

    const findSpy = vi.spyOn(dbHelpers, 'findExistingProceduralMemory');

    const result = await handleMemoryItem(
      {
        type: 'procedural',
        content: 'proc updated via memory_id',
        memory_id: 'mem_proc_target',
        update_mode: 'replace',
        workflow_name: 'wf-a',
        skill_name: 'sk-a',
      },
      context,
      baseCtx('procedural'),
      host,
    );
    const data = parsePayload(result);

    expect(findSpy).not.toHaveBeenCalled();
    expect(data.memory_id).toBe('mem_proc_target');
    expect(data.updated).toBe(true);

    const row = DatabaseUtils.get(db, 'SELECT content FROM memory_item WHERE id = ?', ['mem_proc_target']) as { content: string };
    expect(row.content).toBe('proc updated via memory_id');

    const other = DatabaseUtils.get(db, 'SELECT content FROM memory_item WHERE id = ?', ['mem_proc_other']) as { content: string };
    expect(other.content).toBe('proc other');
  });

  it('memory_id 없이 update_mode incremental은 near-dup 병합을 유지한다', async () => {
    insertMemory(db, {
      id: 'mem_near_dup',
      type: 'semantic',
      content: OVERLAPPING_BASE,
      owner_id: 'owner-a',
      project_id: 'proj-a',
      importance: 0.4,
      tags: '["a"]',
      num_times: 2,
    });

    searchMock.mockResolvedValue([
      {
        memory_id: 'mem_near_dup',
        similarity: 0.93,
        content: OVERLAPPING_BASE,
        type: 'semantic',
        owner_id: 'owner-a',
        project_id: 'proj-a',
      },
    ]);

    const result = await handleMemoryItem(
      {
        type: 'semantic',
        content: OVERLAPPING_VARIANT,
        update_mode: 'incremental',
        importance: 0.7,
        tags: ['b'],
      },
      context,
      baseCtx('semantic'),
      host,
    );
    const data = parsePayload(result);

    expect(data.memory_id).toBe('mem_near_dup');
    expect(data.similarity_warning?.action).toBe('merged');
    expect(generateEmbeddingMock).toHaveBeenCalled();

    const count = DatabaseUtils.get(db, 'SELECT COUNT(*) AS c FROM memory_item', []) as { c: number };
    expect(count.c).toBe(1);
  });
});
