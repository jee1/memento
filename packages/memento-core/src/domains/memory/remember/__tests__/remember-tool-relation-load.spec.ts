import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';
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
      is_consolidated BOOLEAN DEFAULT FALSE,
      owner_id TEXT,
      is_deleted INTEGER DEFAULT 0
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

    it('새 기억과 같은 owner 의 삭제되지 않은 기억만 후보로 반환한다', async () => {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, owner_id, is_deleted) VALUES
          ('mem-a-1', 'semantic', 'A 의 지식', 'agent-a', 0),
          ('mem-a-deleted', 'semantic', 'A 의 지운 지식', 'agent-a', 1),
          ('mem-b-1', 'semantic', 'B 의 지식', 'agent-b', 0),
          ('mem-null-1', 'semantic', '소유자 없는 지식', NULL, 0),
          ('mem-a-new', 'episodic', 'A 의 새 기억', 'agent-a', 0),
          ('mem-null-new', 'episodic', '소유자 없는 새 기억', NULL, 0)
      `);

      const forA = await getExistingMemoriesForRelationExtraction(db, 'mem-a-new', 100, host);
      expect(forA.map((m) => m.id)).toEqual(['mem-a-1']);

      const forNull = await getExistingMemoriesForRelationExtraction(db, 'mem-null-new', 100, host);
      expect(forNull.map((m) => m.id)).toEqual(['mem-null-1']);
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

    it('memory_embedding과 memory_item_vec_minilm이 있으면 저장된 임베딩으로 vec0 KNN 후보를 우선 반환한다 (#1473)', async () => {
      const vecDb = await setupTestDatabase();
      try {
        const makeVecJson = (val: number) => {
          const arr = new Array(384).fill(0);
          arr[0] = val;
          arr[1] = 1 - val;
          return JSON.stringify(arr);
        };

        DatabaseUtils.run(vecDb, `
          INSERT INTO memory_item (id, type, content, created_at, owner_id, is_deleted) VALUES
            ('mem-old-near', 'semantic', '오래되었지만 의미가 매우 가까운 기억', '2025-01-01T00:00:00.000Z', 'agent-a', 0),
            ('mem-recent-far', 'semantic', '최신이지만 의미가 먼 기억', '2026-05-01T00:00:00.000Z', 'agent-a', 0),
            ('mem-new', 'episodic', '새 기억', '2026-06-01T00:00:00.000Z', 'agent-a', 0)
        `);

        const vecNew = makeVecJson(1.0);
        const vecNear = makeVecJson(0.99);
        const vecFar = makeVecJson(0.0);

        const insertEmb = vecDb.prepare(`
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model, precision, normalized, version, created_by
          ) VALUES (?, 'minilm', 'native', ?, 384, 384, ?, 32, 1, 1, 'test')
        `);

        insertEmb.run('mem-old-near', vecNear, MINILM_MODEL_NAME);
        insertEmb.run('mem-recent-far', vecFar, MINILM_MODEL_NAME);
        insertEmb.run('mem-new', vecNew, MINILM_MODEL_NAME);

        const candidates = await getExistingMemoriesForRelationExtraction(vecDb, 'mem-new', 1, host);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]?.id).toBe('mem-old-near');
      } finally {
        vecDb.close();
      }
    });

    it('재색인 중 구버전 MiniLM 모델 행이 섞여 있어도 현재 모델(MINILM_MODEL_NAME) 후보만 선정한다 (#1473)', async () => {
      const vecDb = await setupTestDatabase();
      try {
        const makeVecJson = (val: number) => {
          const arr = new Array(384).fill(0);
          arr[0] = val;
          arr[1] = 1 - val;
          return JSON.stringify(arr);
        };

        DatabaseUtils.run(vecDb, `
          INSERT INTO memory_item (id, type, content, created_at, owner_id, is_deleted) VALUES
            ('mem-legacy-closest', 'semantic', '구모델이지만 수치상 거리가 가장 가까운 기억', '2025-01-01T00:00:00.000Z', 'agent-a', 0),
            ('mem-current-near', 'semantic', '현재 모델로 임베딩된 가까운 기억', '2025-02-01T00:00:00.000Z', 'agent-a', 0),
            ('mem-new', 'episodic', '새 기억', '2026-06-01T00:00:00.000Z', 'agent-a', 0)
        `);

        const insertEmb = vecDb.prepare(`
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model, precision, normalized, version, created_by
          ) VALUES (?, 'minilm', 'native', ?, 384, 384, ?, 32, 1, 1, 'test')
        `);

        insertEmb.run('mem-legacy-closest', makeVecJson(1.0), 'all-MiniLM-L6-v2');
        insertEmb.run('mem-current-near', makeVecJson(0.9), MINILM_MODEL_NAME);
        insertEmb.run('mem-new', makeVecJson(1.0), MINILM_MODEL_NAME);

        const candidates = await getExistingMemoriesForRelationExtraction(vecDb, 'mem-new', 1, host);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]?.id).toBe('mem-current-near');
      } finally {
        vecDb.close();
      }
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
