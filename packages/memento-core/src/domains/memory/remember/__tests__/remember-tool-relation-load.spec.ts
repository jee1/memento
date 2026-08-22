import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RememberTool } from '../remember-tool.js';
import {
  getExistingMemoriesForRelationExtraction,
  getMemoryById,
} from '../remember-tool-db-helpers.js';
import type { RememberToolHost } from '../remember-tool-host.js';

/**
 * 운영 DB와 동일: memory_item에 embedding 컬럼 없음, is_consolidated 있음.
 * 임베딩은 memory_embedding 테이블에 저장된다.
 */
function initializeProductionLikeSchema(db: Database.Database): void {
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
  `);
}

function createHost(tool: RememberTool): RememberToolHost {
  return {
    logInfo: (msg, data) => (tool as any).logInfo(msg, data),
    logWarning: (msg, data) => (tool as any).logWarning(msg, data),
    logError: (err, ctx, data) => (tool as any).logError(err, ctx, data),
    createSuccessResult: (data) => (tool as any).createSuccessResult(data),
  };
}

describe('RememberTool relation load (Issue #544)', () => {
  let db: Database.Database;
  let tool: RememberTool;
  let host: RememberToolHost;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeProductionLikeSchema(db);
    tool = new RememberTool();
    host = createHost(tool);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('getExistingMemoriesForRelationExtraction', () => {
    it('embedding 컬럼 없는 스키마에서 기존 기억을 반환한다', async () => {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, is_consolidated)
        VALUES ('mem-existing-1', 'semantic', '기존 지식 A', 0.7, 'private', 0, 0)
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, is_consolidated)
        VALUES ('mem-existing-2', 'episodic', '기존 경험 B', 0.5, 'team', 1, 1)
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, is_consolidated)
        VALUES ('mem-new', 'episodic', '새로 저장된 기억', 0.6, 'private', 0, 0)
      `);

      const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

      const existing = await getExistingMemoriesForRelationExtraction(
        db,
        'mem-new',
        100,
        host
      );

      expect(existing).toHaveLength(2);
      expect(existing.map((m: { id: string }) => m.id).sort()).toEqual([
        'mem-existing-1',
        'mem-existing-2',
      ]);
      expect(existing[0]).toMatchObject({
        type: expect.any(String),
        content: expect.any(String),
        importance: expect.any(Number),
      });

      const relationLoadWarnings = logWarningSpy.mock.calls.filter(
        (call) => call[0] === '기존 기억 조회 실패'
      );
      expect(relationLoadWarnings).toHaveLength(0);
    });

    it('조회 실패 시 기존 기억 조회 실패 warn을 남기지 않는다', async () => {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content)
        VALUES ('mem-only', 'semantic', '단일 기억')
      `);

      const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

      const existing = await getExistingMemoriesForRelationExtraction(
        db,
        'mem-other',
        10,
        host
      );

      expect(existing).toHaveLength(1);
      expect(existing[0].id).toBe('mem-only');

      const relationLoadWarnings = logWarningSpy.mock.calls.filter(
        (call) => call[0] === '기존 기억 조회 실패'
      );
      expect(relationLoadWarnings).toHaveLength(0);
    });
  });

  describe('getMemoryById', () => {
    it('id로 memory_item 행을 조회해 content/type 등을 반환한다', async () => {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (
          id, type, content, importance, privacy_scope, pinned, tags, source, is_consolidated
        ) VALUES (
          'mem-target',
          'semantic',
          '대상 기억 내용',
          0.8,
          'public',
          1,
          '["tag-a"]',
          'test-source',
          0
        )
      `);

      const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

      const memory = await getMemoryById(db, 'mem-target', host);

      expect(memory).not.toBeNull();
      expect(memory).toMatchObject({
        id: 'mem-target',
        type: 'semantic',
        content: '대상 기억 내용',
        importance: 0.8,
        privacy_scope: 'public',
        pinned: true,
        tags: ['tag-a'],
        source: 'test-source',
        isConsolidated: false,
      });
      expect(memory!.created_at).toBeInstanceOf(Date);

      const lookupWarnings = logWarningSpy.mock.calls.filter(
        (call) => call[0] === '기억 조회 실패'
      );
      expect(lookupWarnings).toHaveLength(0);
    });

    it('존재하지 않는 id면 null을 반환한다', async () => {
      const memory = await getMemoryById(db, 'missing-id', host);
      expect(memory).toBeNull();
    });
  });
});
