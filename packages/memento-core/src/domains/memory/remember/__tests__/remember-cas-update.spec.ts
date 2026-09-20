import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ToolInputValidationError } from '../../../../shared/errors/tool-input-validation-error.js';
import {
  MemoryVersionConflictError,
  memoryItemEffectiveVersion,
} from '../../../../shared/errors/memory-version-conflict-error.js';
import { handleMemoryItem, type MemoryItemContext } from '../remember-tool-memory-item.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import type { ToolContext } from '../../../../tools/types.js';
import { RememberSchema } from '../remember-tool-schema.js';
import * as configModule from '../../../../shared/config/index.js';
import * as vectorSearchModule from '../../../search/algorithms/vector-search-engine.js';

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
    version?: number | null;
  },
): void {
  db.prepare(`
    INSERT INTO memory_item (
      id, type, content, importance, owner_id, project_id, version, recall_count, num_times
    ) VALUES (?, ?, ?, 0.5, ?, ?, ?, 0, 1)
  `).run(
    row.id,
    row.type,
    row.content,
    row.owner_id ?? null,
    row.project_id ?? null,
    row.version ?? null,
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

function createContext(db: Database.Database, searchMock: ReturnType<typeof vi.fn>): ToolContext {
  return {
    db,
    agentId: 'owner-a',
    services: {
      embeddingService: {
        isAvailable: () => false,
      } as ToolContext['services']['embeddingService'],
      vectorSearchEngine: {
        initialize: vi.fn(),
        search: searchMock,
      } as unknown as ToolContext['services']['vectorSearchEngine'],
      telemetryService: {
        record: vi.fn(),
        hasPriorWriteWithContentHash: vi.fn().mockReturnValue(false),
      } as unknown as ToolContext['services']['telemetryService'],
      consolidationScoreService: null,
    },
  };
}

function baseCtx(overrides: Partial<MemoryItemContext> = {}): MemoryItemContext {
  return {
    type: 'semantic',
    ownerId: 'owner-a',
    processId: null,
    sessionId: null,
    numTimes: 1,
    sourceSessionId: null,
    confidenceVal: null,
    origin_source: '{}',
    startTime: Date.now(),
    project_id_param: 'proj-a',
    last_mentioned_at_param: undefined,
    ...overrides,
  };
}

describe('memoryItemEffectiveVersion', () => {
  it('treats NULL as 1', () => {
    expect(memoryItemEffectiveVersion(null)).toBe(1);
    expect(memoryItemEffectiveVersion(undefined)).toBe(1);
    expect(memoryItemEffectiveVersion(3)).toBe(3);
  });
});

describe('RememberSchema expected_version', () => {
  it('rejects expected_version without memory_id', () => {
    const result = RememberSchema.safeParse({
      content: 'x',
      type: 'semantic',
      update_mode: 'replace',
      expected_version: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer expected_version', () => {
    const result = RememberSchema.safeParse({
      content: 'x',
      type: 'semantic',
      memory_id: 'mem-1',
      update_mode: 'replace',
      expected_version: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects expected_version below 1', () => {
    const result = RememberSchema.safeParse({
      content: 'x',
      type: 'semantic',
      memory_id: 'mem-1',
      update_mode: 'replace',
      expected_version: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects expected_version with versioned update_mode', () => {
    const result = RememberSchema.safeParse({
      content: 'x',
      type: 'semantic',
      memory_id: 'mem-1',
      update_mode: 'versioned',
      expected_version: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('remember CAS update (Issue #1093 Phase 1)', () => {
  let db: Database.Database;
  let host: RememberToolHost;
  let context: ToolContext;
  let searchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);
    host = createHost();
    searchMock = vi.fn().mockResolvedValue([]);

    vi.spyOn(vectorSearchModule, 'getVectorSearchEngine').mockReturnValue({
      initialize: vi.fn(),
      search: searchMock,
    } as unknown as vectorSearchModule.VectorSearchEngine);

    vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'off',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
      consolidationScoreEnabled: false,
    });

    context = createContext(db, searchMock);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function parsePayload(result: Awaited<ReturnType<typeof handleMemoryItem>>) {
    return JSON.parse(result.content[0]!.text as string);
  }

  it('updates with matching expected_version and increments version', async () => {
    insertMemory(db, {
      id: 'mem-cas-1',
      type: 'semantic',
      content: 'original',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      version: null,
    });

    const result = await handleMemoryItem(
      {
        content: 'updated',
        type: 'semantic',
        memory_id: 'mem-cas-1',
        update_mode: 'replace',
        expected_version: 1,
      },
      context,
      baseCtx(),
      host,
    );

    const payload = parsePayload(result);
    expect(payload.updated).toBe(true);
    expect(payload.version).toBe(2);

    const row = db.prepare('SELECT content, version FROM memory_item WHERE id = ?').get('mem-cas-1') as {
      content: string;
      version: number;
    };
    expect(row.content).toBe('updated');
    expect(row.version).toBe(2);
  });

  it('returns typed 409 conflict on stale expected_version and preserves winning content', async () => {
    insertMemory(db, {
      id: 'mem-cas-2',
      type: 'semantic',
      content: 'winner',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      version: 2,
    });

    await expect(
      handleMemoryItem(
        {
          content: 'loser',
          type: 'semantic',
          memory_id: 'mem-cas-2',
          update_mode: 'replace',
          expected_version: 1,
        },
        context,
        baseCtx(),
        host,
      ),
    ).rejects.toBeInstanceOf(MemoryVersionConflictError);

    const row = db.prepare('SELECT content, version FROM memory_item WHERE id = ?').get('mem-cas-2') as {
      content: string;
      version: number;
    };
    expect(row.content).toBe('winner');
    expect(row.version).toBe(2);
  });

  it('omitting expected_version keeps legacy update without touching version', async () => {
    insertMemory(db, {
      id: 'mem-cas-3',
      type: 'semantic',
      content: 'before',
      owner_id: 'owner-a',
      project_id: 'proj-a',
      version: null,
    });

    const result = await handleMemoryItem(
      {
        content: 'legacy-updated',
        type: 'semantic',
        memory_id: 'mem-cas-3',
        update_mode: 'replace',
      },
      context,
      baseCtx(),
      host,
    );

    const payload = parsePayload(result);
    expect(payload.updated).toBe(true);
    expect(payload.version).toBeUndefined();

    const row = db.prepare('SELECT content, version FROM memory_item WHERE id = ?').get('mem-cas-3') as {
      content: string;
      version: number | null;
    };
    expect(row.content).toBe('legacy-updated');
    expect(row.version).toBeNull();
  });

  it('rejects cross-owner update without mutating target row', async () => {
    insertMemory(db, {
      id: 'mem-cas-4',
      type: 'semantic',
      content: 'private-secret',
      owner_id: 'owner-b',
      project_id: 'proj-a',
      version: 1,
    });

    await expect(
      handleMemoryItem(
        {
          content: 'stolen',
          type: 'semantic',
          memory_id: 'mem-cas-4',
          update_mode: 'replace',
          expected_version: 1,
        },
        context,
        baseCtx({ ownerId: 'owner-a' }),
        host,
      ),
    ).rejects.toBeInstanceOf(ToolInputValidationError);

    const row = db.prepare('SELECT content FROM memory_item WHERE id = ?').get('mem-cas-4') as {
      content: string;
    };
    expect(row.content).toBe('private-secret');
  });

  it('rejects cross-project update without mutating target row', async () => {
    insertMemory(db, {
      id: 'mem-cas-5',
      type: 'semantic',
      content: 'project-secret',
      owner_id: 'owner-a',
      project_id: 'proj-b',
      version: 1,
    });

    await expect(
      handleMemoryItem(
        {
          content: 'stolen',
          type: 'semantic',
          memory_id: 'mem-cas-5',
          update_mode: 'replace',
          expected_version: 1,
        },
        context,
        baseCtx({ project_id_param: 'proj-a' }),
        host,
      ),
    ).rejects.toBeInstanceOf(ToolInputValidationError);

    const row = db.prepare('SELECT content FROM memory_item WHERE id = ?').get('mem-cas-5') as {
      content: string;
    };
    expect(row.content).toBe('project-secret');
  });

});
