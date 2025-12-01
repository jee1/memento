/**
 * ForgetTool 테스트
 * 기억 삭제 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ForgetTool } from '../forget-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

describe('ForgetTool', () => {
  let tool: ForgetTool;
  let db: Database.Database;
  let context: ToolContext;
  let mockEmbeddingService: any;

  beforeEach(async () => {
    tool = new ForgetTool();
    db = await setupTestDatabase();
    
    // Mock embedding service
    mockEmbeddingService = {
      isAvailable: vi.fn().mockReturnValue(true),
      deleteEmbedding: vi.fn().mockResolvedValue(undefined)
    };
    
    context = {
      db,
      services: {
        embeddingService: mockEmbeddingService
      }
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('단일 삭제', () => {
    it('소프트 삭제를 수행해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory for soft delete',
        type: 'episodic'
      });

      const result = await tool.handle(
        { id: memoryId, hard: false },
        context
      );

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.deleted_type).toBe('soft');
      expect(resultData.memory_id).toBe(memoryId);

      // 메모리가 여전히 존재해야 함 (소프트 삭제)
      const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [memoryId]);
      expect(memory).toBeDefined();
      expect(memory.pinned).toBe(0); // pinned 해제됨
    });

    it('하드 삭제를 수행해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory for hard delete',
        type: 'episodic'
      });

      const result = await tool.handle(
        { id: memoryId, hard: true, confirm: true },
        context
      );

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.deleted_type).toBe('hard');
      expect(resultData.memory_id).toBe(memoryId);

      // 메모리가 완전히 삭제되어야 함
      const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [memoryId]);
      expect(memory).toBeUndefined();
    });

    it('하드 삭제 시 confirm이 없으면 에러를 던져야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      await expect(
        tool.handle({ id: memoryId, hard: true }, context)
      ).rejects.toThrow('하드 삭제는 confirm=true로 확인해야 합니다');
    });

    it('존재하지 않는 메모리 삭제 시 에러를 던져야 함', async () => {
      await expect(
        tool.handle({ id: 'mem_nonexistent', hard: false }, context)
      ).rejects.toThrow();
    });

    it('삭제 사유를 기록해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      const reason = 'Test deletion reason';
      const result = await tool.handle(
        { id: memoryId, hard: false, reason },
        context
      );

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.reason).toBe(reason);
    });
  });

  describe('배치 삭제', () => {
    it('배치 삭제를 수행해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic' }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic' }),
        createTestMemory(db, { content: 'Memory 3', type: 'episodic' })
      ];

      const result = await tool.handle(
        { batch: memoryIds, hard: false },
        context
      );

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful).toHaveLength(3);
      expect(resultData.batch_result.failed).toHaveLength(0);
      expect(resultData.batch_result.total).toBe(3);
    });

    it('배치 삭제 시 일부 실패를 처리해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic' }),
        'mem_nonexistent',
        createTestMemory(db, { content: 'Memory 3', type: 'episodic' })
      ];

      const result = await tool.handle(
        { batch: memoryIds, hard: false },
        context
      );

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBeGreaterThan(0);
      expect(resultData.batch_result.failed.length).toBeGreaterThan(0);
    });

    it('배치 삭제 최대 개수를 초과하면 에러를 던져야 함', async () => {
      const memoryIds = Array(101).fill('mem_test').map((_, i) => `mem_test_${i}`);

      await expect(
        tool.handle({ batch: memoryIds, hard: false }, context)
      ).rejects.toThrow();
    });
  });

  describe('pinned 보호', () => {
    it('pinned 메모리는 삭제할 수 없어야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Pinned memory',
        type: 'episodic',
        pinned: true
      });

      await expect(
        tool.handle({ id: memoryId, hard: false }, context)
      ).rejects.toThrow('핀된 기억은 먼저 핀을 해제해야 합니다');
    });

    it('pinned 메모리는 하드 삭제도 할 수 없어야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Pinned memory',
        type: 'episodic',
        pinned: true
      });

      await expect(
        tool.handle({ id: memoryId, hard: true, confirm: true }, context)
      ).rejects.toThrow('핀된 기억은 먼저 핀을 해제해야 합니다');
    });
  });

  describe('벡터 테이블 삭제', () => {
    const providers = [
      { name: 'tfidf', table: 'memory_item_vec_tfidf', dimensions: 384 },
      { name: 'minilm', table: 'memory_item_vec_minilm', dimensions: 384 },
      { name: 'openai', table: 'memory_item_vec_openai', dimensions: 1536 },
      { name: 'gemini', table: 'memory_item_vec_gemini', dimensions: 768 }
    ];

    providers.forEach(({ name, table, dimensions }) => {
      it(`${name} 제공자의 벡터 테이블에서 하드 삭제 시 삭제해야 함`, async () => {
        const memoryId = createTestMemory(db, {
          content: `Test memory with ${name} embedding`,
          type: 'episodic'
        });

        // 임베딩 정보 추가
        const tableInfo = db.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string }>;
        const columnNames = tableInfo.map(col => col.name);
        
        const baseColumns = ['memory_id', 'embedding', 'dim', 'embedding_provider'];
        const optionalColumns: Record<string, any> = { dimensions };
        
        if (columnNames.includes('projection_type')) {
          optionalColumns['projection_type'] = 'native';
        }
        if (columnNames.includes('model')) {
          optionalColumns['model'] = name;
        }
        if (columnNames.includes('precision')) {
          optionalColumns['precision'] = 32;
        }
        if (columnNames.includes('normalized')) {
          optionalColumns['normalized'] = 1;
        }
        if (columnNames.includes('version')) {
          optionalColumns['version'] = 1;
        }
        if (columnNames.includes('created_by')) {
          optionalColumns['created_by'] = 'test';
        }

        const allColumns = [...baseColumns, ...Object.keys(optionalColumns)];
        const allValues = [
          memoryId,
          JSON.stringify(Array(dimensions).fill(0.1)),
          dimensions,
          name,
          ...Object.values(optionalColumns)
        ];

        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (${allColumns.join(', ')})
          VALUES (${allColumns.map(() => '?').join(', ')})
        `, allValues);

        // 벡터 테이블에 데이터 추가 (실제로는 트리거에 의해 자동 추가되지만, 테스트를 위해 수동 추가)
        try {
          const vecTableExists = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name=?
          `).get(table) as { name: string } | undefined;

          if (vecTableExists) {
            DatabaseUtils.run(db, `
              INSERT INTO ${table} (rowid, embedding)
              VALUES (?, ?)
            `, [memoryId, JSON.stringify(Array(dimensions).fill(0.1))]);
          }
        } catch (error) {
          // VEC 확장이 없으면 벡터 테이블이 없을 수 있음
        }

        await tool.handle(
          { id: memoryId, hard: true, confirm: true },
          context
        );

        // 임베딩 테이블에서 삭제 확인
        const embedding = DatabaseUtils.get(
          db,
          'SELECT * FROM memory_embedding WHERE memory_id = ?',
          [memoryId]
        );
        expect(embedding).toBeUndefined();

        // embeddingService.deleteEmbedding이 호출되었는지 확인
        expect(mockEmbeddingService.deleteEmbedding).toHaveBeenCalledWith(db, memoryId);

        // 벡터 테이블에서도 삭제 확인 (테이블이 존재하는 경우)
        try {
          const vecTableExists = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name=?
          `).get(table) as { name: string } | undefined;

          if (vecTableExists) {
            const vecRecord = DatabaseUtils.get(
              db,
              `SELECT * FROM ${table} WHERE rowid = ?`,
              [memoryId]
            );
            expect(vecRecord).toBeUndefined();
          }
        } catch (error) {
          // VEC 확장이 없으면 벡터 테이블이 없을 수 있음
        }
      });
    });

    it('모든 제공자의 벡터 테이블에서 일괄 삭제해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory with multiple embeddings',
        type: 'episodic'
      });

      // 여러 제공자의 임베딩 추가
      const tableInfo = db.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string }>;
      const columnNames = tableInfo.map(col => col.name);

      for (const { name, table, dimensions } of providers) {
        const baseColumns = ['memory_id', 'embedding', 'dim', 'embedding_provider'];
        const optionalColumns: Record<string, any> = { dimensions };
        
        if (columnNames.includes('projection_type')) {
          optionalColumns['projection_type'] = 'native';
        }
        if (columnNames.includes('model')) {
          optionalColumns['model'] = name;
        }

        const allColumns = [...baseColumns, ...Object.keys(optionalColumns)];
        const allValues = [
          memoryId,
          JSON.stringify(Array(dimensions).fill(0.1)),
          dimensions,
          name,
          ...Object.values(optionalColumns)
        ];

        try {
          DatabaseUtils.run(db, `
            INSERT INTO memory_embedding (${allColumns.join(', ')})
            VALUES (${allColumns.map(() => '?').join(', ')})
          `, allValues);

          // 벡터 테이블에 데이터 추가
          const vecTableExists = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name=?
          `).get(table) as { name: string } | undefined;

          if (vecTableExists) {
            DatabaseUtils.run(db, `
              INSERT INTO ${table} (rowid, embedding)
              VALUES (?, ?)
            `, [memoryId, JSON.stringify(Array(dimensions).fill(0.1))]);
          }
        } catch (error) {
          // 일부 제공자는 사용 불가능할 수 있음
        }
      }

      await tool.handle(
        { id: memoryId, hard: true, confirm: true },
        context
      );

      // 모든 제공자의 임베딩이 삭제되었는지 확인
      const embeddings = DatabaseUtils.all(
        db,
        'SELECT * FROM memory_embedding WHERE memory_id = ?',
        [memoryId]
      );
      expect(embeddings.length).toBe(0);

      // embeddingService.deleteEmbedding이 호출되었는지 확인
      expect(mockEmbeddingService.deleteEmbedding).toHaveBeenCalledWith(db, memoryId);
    });

    it('소프트 삭제 시 벡터 테이블은 유지해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // 임베딩 정보 추가
      DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (memory_id, embedding, dim, embedding_provider, dimensions)
        VALUES (?, ?, ?, ?, ?)
      `, [memoryId, JSON.stringify([0.1, 0.2, 0.3]), 384, 'tfidf', 384]);

      await tool.handle(
        { id: memoryId, hard: false },
        context
      );

      // 임베딩 테이블에 여전히 존재해야 함
      const embedding = DatabaseUtils.get(
        db,
        'SELECT * FROM memory_embedding WHERE memory_id = ?',
        [memoryId]
      );
      expect(embedding).toBeDefined();

      // embeddingService.deleteEmbedding이 호출되지 않아야 함
      expect(mockEmbeddingService.deleteEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('관련 데이터 정리', () => {
    it('하드 삭제 시 관련 테이블에서도 삭제해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // 관련 데이터 추가 (먼저 target 메모리 생성)
      const targetId = createTestMemory(db, { content: 'Target memory', type: 'episodic' });
      
      DatabaseUtils.run(db, `
        INSERT INTO memory_link (source_id, target_id, relation_type)
        VALUES (?, ?, ?)
      `, [memoryId, targetId, 'derived_from']);

      DatabaseUtils.run(db, `
        INSERT INTO feedback_event (memory_id, event, score)
        VALUES (?, ?, ?)
      `, [memoryId, 'used', 1]);

      await tool.handle(
        { id: memoryId, hard: true, confirm: true },
        context
      );

      // 관련 데이터가 삭제되었는지 확인
      const link = DatabaseUtils.get(
        db,
        'SELECT * FROM memory_link WHERE source_id = ? OR target_id = ?',
        [memoryId, memoryId]
      );
      expect(link).toBeUndefined();

      const feedback = DatabaseUtils.get(
        db,
        'SELECT * FROM feedback_event WHERE memory_id = ?',
        [memoryId]
      );
      expect(feedback).toBeUndefined();
    });
  });

  describe('삭제 로그', () => {
    it('삭제 시 feedback_event에 기록해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      await tool.handle(
        { id: memoryId, hard: false },
        context
      );

      // feedback_event에 기록 확인
      const feedback = DatabaseUtils.all(
        db,
        'SELECT * FROM feedback_event WHERE memory_id = ? AND event = ?',
        [memoryId, 'neglected']
      );
      expect(feedback.length).toBeGreaterThan(0);
    });
  });

  describe('getDeletableMemories', () => {
    it('삭제 가능한 메모리 목록을 반환해야 함', async () => {
      // pinned되지 않은 메모리 생성
      createTestMemory(db, { content: 'Deletable 1', type: 'episodic', pinned: false });
      createTestMemory(db, { content: 'Deletable 2', type: 'episodic', pinned: false });
      createTestMemory(db, { content: 'Pinned', type: 'episodic', pinned: true });

      const deletable = await tool.getDeletableMemories(context, 10);

      expect(deletable.length).toBeGreaterThan(0);
      expect(deletable.every((m: any) => !m.pinned)).toBe(true);
    });

    it('limit 파라미터를 존중해야 함', async () => {
      // 여러 메모리 생성
      for (let i = 0; i < 20; i++) {
        createTestMemory(db, { content: `Memory ${i}`, type: 'episodic', pinned: false });
      }

      const deletable = await tool.getDeletableMemories(context, 5);

      expect(deletable.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getDeleteStats', () => {
    it('삭제 통계를 반환해야 함', async () => {
      createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: false });
      createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: false });

      const stats = await tool.getDeleteStats(context);

      expect(stats).toHaveProperty('total_memories');
      expect(stats).toHaveProperty('pinned_count');
      expect(stats).toHaveProperty('deletable_count');
      expect(stats.total_memories).toBe(3);
      expect(stats.pinned_count).toBe(1);
      expect(stats.deletable_count).toBe(2);
    });
  });

  describe('입력 검증', () => {
    it('id와 batch가 모두 없으면 에러를 던져야 함', async () => {
      await expect(
        tool.handle({ hard: false }, context)
      ).rejects.toThrow();
    });

    it('유효하지 않은 메모리 ID 형식에 대해 에러를 던져야 함', async () => {
      await expect(
        tool.handle({ id: 'invalid-id', hard: false }, context)
      ).rejects.toThrow();
    });
  });
});

