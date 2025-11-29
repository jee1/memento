/**
 * UnpinTool 테스트
 * 기억 고정 해제 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { UnpinTool } from './unpin-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';

describe('UnpinTool', () => {
  let tool: UnpinTool;
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    tool = new UnpinTool();
    db = await setupTestDatabase();
    context = {
      db,
      services: {}
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('단일 고정 해제', () => {
    it('메모리 고정을 해제해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory to unpin',
        type: 'episodic',
        pinned: true
      });

      const result = await tool.handle({ id: memoryId }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe(memoryId);
      expect(resultData.message).toContain('고정이 해제되었습니다');

      // 메모리가 실제로 고정 해제되었는지 확인
      const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [memoryId]);
      expect(memory.pinned).toBe(0);
    });

    it('이미 고정 해제된 메모리는 재해제하지 않아야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Already unpinned memory',
        type: 'episodic',
        pinned: false
      });

      const result = await tool.handle({ id: memoryId }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.already_unpinned).toBe(true);
      expect(resultData.message).toContain('이미 고정 해제되어 있습니다');
    });

    it('높은 중요도의 메모리는 confirm이 필요해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'High importance memory',
        type: 'episodic',
        pinned: true,
        importance: 0.9
      });

      await expect(
        tool.handle({ id: memoryId }, context)
      ).rejects.toThrow('높은 중요도의 기억은 confirm=true로 확인해야 합니다');
    });

    it('높은 중요도의 메모리는 confirm=true로 해제할 수 있어야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'High importance memory',
        type: 'episodic',
        pinned: true,
        importance: 0.9
      });

      const result = await tool.handle({ id: memoryId, confirm: true }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe(memoryId);

      const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [memoryId]);
      expect(memory.pinned).toBe(0);
    });

    it('고정 해제 사유를 기록해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: true
      });

      const reason = 'No longer needed';
      const result = await tool.handle({ id: memoryId, reason }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.reason).toBe(reason);
    });

    it('존재하지 않는 메모리 고정 해제 시 에러를 던져야 함', async () => {
      await expect(
        tool.handle({ id: 'mem_nonexistent' }, context)
      ).rejects.toThrow();
    });
  });

  describe('배치 고정 해제', () => {
    it('배치 고정 해제를 수행해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true }),
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: true })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBe(3);
      expect(resultData.batch_result.failed.length).toBe(0);
      expect(resultData.batch_result.total).toBe(3);
    });

    it('배치 고정 해제 시 이미 해제된 메모리는 건너뛰어야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: false }),
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: true })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBe(2);
      expect(resultData.batch_result.already_unpinned.length).toBe(1);
    });

    it('배치 고정 해제 시 확인이 필요한 메모리를 처리해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true, importance: 0.5 }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true, importance: 0.9 }),
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: true, importance: 0.5 })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBe(2);
      expect(resultData.batch_result.requires_confirmation.length).toBe(1);
      expect(resultData.requires_confirmation).toBe(true);
    });

    it('배치 고정 해제 시 confirm=true로 모든 메모리를 해제할 수 있어야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true, importance: 0.9 }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true, importance: 0.9 })
      ];

      const result = await tool.handle({ batch: memoryIds, confirm: true }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBe(2);
      expect(resultData.batch_result.requires_confirmation.length).toBe(0);
    });

    it('배치 고정 해제 시 일부 실패를 처리해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true }),
        'mem_nonexistent',
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: true })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBeGreaterThan(0);
      expect(resultData.batch_result.failed.length).toBeGreaterThan(0);
    });
  });

  describe('고정 해제 로그', () => {
    it('고정 해제 시 feedback_event에 기록해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: true
      });

      await tool.handle({ id: memoryId }, context);

      // feedback_event에 기록 확인
      const feedback = DatabaseUtils.all(
        db,
        'SELECT * FROM feedback_event WHERE memory_id = ? AND event = ?',
        [memoryId, 'edited']
      );
      expect(feedback.length).toBeGreaterThan(0);
    });
  });

  describe('getUnpinnableMemories', () => {
    it('고정 해제 가능한 메모리 목록을 반환해야 함', async () => {
      createTestMemory(db, { content: 'Pinned 1', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Pinned 2', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Unpinned', type: 'episodic', pinned: false });

      const unpinnable = await tool.getUnpinnableMemories(context, 10);

      expect(unpinnable.length).toBe(2);
      // SELECT에 pinned 필드가 포함되지 않으므로, 메모리가 실제로 고정되었는지 확인
      const allPinned = await Promise.all(
        unpinnable.map(async (m: any) => {
          const memory = DatabaseUtils.get(db, 'SELECT pinned FROM memory_item WHERE id = ?', [m.id]);
          return memory?.pinned === 1 || memory?.pinned === true;
        })
      );
      expect(allPinned.every(p => p)).toBe(true);
    });

    it('limit 파라미터를 존중해야 함', async () => {
      for (let i = 0; i < 20; i++) {
        createTestMemory(db, { content: `Pinned ${i}`, type: 'episodic', pinned: true });
      }

      const unpinnable = await tool.getUnpinnableMemories(context, 5);

      expect(unpinnable.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getUnpinStats', () => {
    it('고정 해제 통계를 반환해야 함', async () => {
      createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: false });

      const stats = await tool.getUnpinStats(context);

      expect(stats).toHaveProperty('total_memories');
      expect(stats).toHaveProperty('pinned_count');
      expect(stats).toHaveProperty('unpinned_count');
      expect(stats.total_memories).toBe(3);
      expect(stats.pinned_count).toBe(2);
      expect(stats.unpinned_count).toBe(1);
    });
  });

  describe('getRecommendedUnpins', () => {
    it('고정 해제 권장 메모리 목록을 반환해야 함', async () => {
      // 낮은 중요도이고 오래된 메모리 생성
      createTestMemory(db, {
        content: 'Old low importance',
        type: 'episodic',
        pinned: true,
        importance: 0.3
      });

      const recommended = await tool.getRecommendedUnpins(context, 10);

      // 결과가 배열이어야 함
      expect(Array.isArray(recommended)).toBe(true);
    });
  });

  describe('입력 검증', () => {
    it('id와 batch가 모두 없으면 에러를 던져야 함', async () => {
      await expect(
        tool.handle({}, context)
      ).rejects.toThrow();
    });

    it('유효하지 않은 메모리 ID 형식에 대해 에러를 던져야 함', async () => {
      await expect(
        tool.handle({ id: 'invalid-id' }, context)
      ).rejects.toThrow();
    });
  });
});

