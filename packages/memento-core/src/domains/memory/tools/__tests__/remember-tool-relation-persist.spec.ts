import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import type { ToolContext } from '../../../../tools/types.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import { runRelationExtraction } from '../remember-tool-augmentation.js';

/**
 * Issue #711: 관계 추출 결과(runRelationExtraction)가 memory_relation에 영속화되는지 검증.
 */
function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      is_consolidated BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );
  `);
}

function createHost(): RememberToolHost & { logInfo: ReturnType<typeof vi.fn>; logWarning: ReturnType<typeof vi.fn> } {
  return {
    logInfo: vi.fn(),
    logWarning: vi.fn(),
    logError: vi.fn(),
    createSuccessResult: vi.fn((data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })),
    createErrorResult: vi.fn((error, message, data) => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: { code: error, message: message ?? error },
          ...(data ? { data } : {}),
        }),
      }],
      error,
    })),
  };
}

describe('runRelationExtraction (Issue #711)', () => {
  let db: Database.Database;
  let host: ReturnType<typeof createHost>;
  let context: ToolContext;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);

    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, privacy_scope)
      VALUES ('mem-existing-1', 'semantic', '문제가 발생한 원인 기록', 0.7, 'private')
    `);
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, privacy_scope)
      VALUES ('mem-new', 'episodic', '서버 과부하 때문에 장애가 발생했다', 0.6, 'private')
    `);

    host = createHost();
    context = {
      db,
      services: {
        relationGraph: createRelationGraph(db)
      }
    };
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('하이브리드 추출 후보를 memory_relation에 저장한다 (method/evidence/extracted_at 포함)', async () => {
    await runRelationExtraction(
      {
        dbRef: db,
        savedMemoryId: 'mem-new',
        savedMemoryType: 'episodic',
        content: '서버 과부하 때문에 장애가 발생했다',
        importance: 0.6,
        enable_triple_extraction: false
      },
      context,
      host
    );

    const rows = DatabaseUtils.all(db, `
      SELECT source_id, target_id, relation_type, confidence, metadata
      FROM memory_relation
      WHERE source_id = 'mem-new'
    `) as Array<{ source_id: string; target_id: string; relation_type: string; confidence: number; metadata: string | null }>;

    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!;
    expect(row.target_id).toBe('mem-existing-1');
    expect(row.confidence).toBeGreaterThanOrEqual(0.5);

    const metadata = JSON.parse(row.metadata ?? '{}');
    expect(metadata.method).toBe('rule');
    expect(typeof metadata.evidence).toBe('string');
    expect(metadata.evidence.length).toBeGreaterThan(0);
    expect(typeof metadata.extracted_at).toBe('string');
  });

  it('재실행해도 관계 행이 늘어나지 않는다 (idempotent)', async () => {
    const params = {
      dbRef: db,
      savedMemoryId: 'mem-new',
      savedMemoryType: 'episodic',
      content: '서버 과부하 때문에 장애가 발생했다',
      importance: 0.6,
      enable_triple_extraction: false
    };

    await runRelationExtraction(params, context, host);
    const firstCount = (DatabaseUtils.all(db, `SELECT id FROM memory_relation WHERE source_id = 'mem-new'`) as unknown[]).length;

    await runRelationExtraction(params, context, host);
    const secondCount = (DatabaseUtils.all(db, `SELECT id FROM memory_relation WHERE source_id = 'mem-new'`) as unknown[]).length;

    expect(firstCount).toBeGreaterThan(0);
    expect(secondCount).toBe(firstCount);
  });

  it('relationGraph가 없으면 저장을 건너뛰고 warning만 남긴다 (remember 실패로 이어지지 않음)', async () => {
    const contextWithoutGraph: ToolContext = { db, services: {} };

    await expect(runRelationExtraction(
      {
        dbRef: db,
        savedMemoryId: 'mem-new',
        savedMemoryType: 'episodic',
        content: '서버 과부하 때문에 장애가 발생했다',
        importance: 0.6,
        enable_triple_extraction: false
      },
      contextWithoutGraph,
      host
    )).resolves.toBeUndefined();

    expect(host.logWarning).toHaveBeenCalled();
    const rows = DatabaseUtils.all(db, `SELECT id FROM memory_relation WHERE source_id = 'mem-new'`) as unknown[];
    expect(rows.length).toBe(0);
  });

  it('배치 부분 실패 시 warning만 남기고 예외를 던지지 않는다', async () => {
    const relationGraph = context.services.relationGraph!;
    vi.spyOn(relationGraph, 'addRelationsBatch').mockResolvedValue({
      insertedIds: [],
      failed: [{ source_id: 'mem-new', target_id: 'mem-existing-1', relation_type: 'CAUSES', error: 'boom' }],
      total: 1,
      success: 0,
      failedCount: 1
    });

    await expect(runRelationExtraction(
      {
        dbRef: db,
        savedMemoryId: 'mem-new',
        savedMemoryType: 'episodic',
        content: '서버 과부하 때문에 장애가 발생했다',
        importance: 0.6,
        enable_triple_extraction: false
      },
      context,
      host
    )).resolves.toBeUndefined();

    expect(host.logWarning).toHaveBeenCalled();
  });

  it('relationGraph.addRelationsBatch가 예외를 던져도 remember 흐름에 영향을 주지 않는다', async () => {
    const relationGraph = context.services.relationGraph!;
    vi.spyOn(relationGraph, 'addRelationsBatch').mockRejectedValue(new Error('db down'));

    await expect(runRelationExtraction(
      {
        dbRef: db,
        savedMemoryId: 'mem-new',
        savedMemoryType: 'episodic',
        content: '서버 과부하 때문에 장애가 발생했다',
        importance: 0.6,
        enable_triple_extraction: false
      },
      context,
      host
    )).resolves.toBeUndefined();

    expect(host.logWarning).toHaveBeenCalled();
  });
});
