/**
 * PinTool 테스트
 * 기억 고정 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { PinTool } from '../pin-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

describe('PinTool', () => {
  let tool: PinTool;
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    tool = new PinTool();
    db = await setupTestDatabase();
    context = {
      db,
      services: {}
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('단일 고정', () => {
    it('메모리를 고정해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory to pin',
        type: 'episodic',
        pinned: false
      });

      const result = await tool.handle({ id: memoryId }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe(memoryId);
      expect(resultData.message).toContain('고정되었습니다');

      // 메모리가 실제로 고정되었는지 확인
      const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [memoryId]);
      expect(memory.pinned).toBe(1);
    });

    it('이미 고정된 메모리는 재고정하지 않아야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Already pinned memory',
        type: 'episodic',
        pinned: true
      });

      const result = await tool.handle({ id: memoryId }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.already_pinned).toBe(true);
      expect(resultData.message).toContain('이미 고정되어 있습니다');
    });

    it('우선순위를 설정할 수 있어야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: false
      });

      const priority = 5;
      const result = await tool.handle({ id: memoryId, priority }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.priority).toBe(priority);
    });

    it('기본 우선순위는 3이어야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: false
      });

      const result = await tool.handle({ id: memoryId }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.priority).toBe(3);
    });

    it('고정 사유를 기록해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: false
      });

      const reason = 'Important memory';
      const result = await tool.handle({ id: memoryId, reason }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.reason).toBe(reason);
    });

    it('존재하지 않는 메모리 고정 시 에러를 던져야 함', async () => {
      await expect(
        tool.handle({ id: 'mem_nonexistent' }, context)
      ).rejects.toThrow();
    });
  });

  describe('배치 고정', () => {
    it('배치 고정을 수행해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: false }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: false }),
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: false })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBe(3);
      expect(resultData.batch_result.failed.length).toBe(0);
      expect(resultData.batch_result.total).toBe(3);
    });

    it('배치 고정 시 이미 고정된 메모리는 건너뛰어야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: false }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true }),
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: false })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBe(2);
      expect(resultData.batch_result.already_pinned.length).toBe(1);
    });

    it('배치 고정 시 일부 실패를 처리해야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: false }),
        'mem_nonexistent',
        createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: false })
      ];

      const result = await tool.handle({ batch: memoryIds }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful.length).toBeGreaterThan(0);
      expect(resultData.batch_result.failed.length).toBeGreaterThan(0);
    });

    it('배치 고정에 우선순위를 적용할 수 있어야 함', async () => {
      const memoryIds = [
        createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: false }),
        createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: false })
      ];

      const priority = 5;
      const result = await tool.handle({ batch: memoryIds, priority }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.priority).toBe(priority);
    });
  });

  describe('고정 로그', () => {
    it('고정 시 feedback_event에 기록해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: false
      });

      const priority = 4;
      await tool.handle({ id: memoryId, priority }, context);

      // feedback_event에 기록 확인
      const feedback = DatabaseUtils.all(
        db,
        'SELECT * FROM feedback_event WHERE memory_id = ? AND event = ?',
        [memoryId, 'helpful']
      );
      expect(feedback.length).toBeGreaterThan(0);
      expect(feedback[0].score).toBe(priority);
    });
  });

  describe('getPinnedMemories', () => {
    it('고정된 메모리 목록을 반환해야 함', async () => {
      createTestMemory(db, { content: 'Pinned 1', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Pinned 2', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Unpinned', type: 'episodic', pinned: false });

      const pinned = await tool.getPinnedMemories(context, 10);

      expect(pinned.length).toBe(2);
      // SELECT에 pinned 필드가 포함되지 않으므로, 메모리가 실제로 고정되었는지 확인
      const allPinned = await Promise.all(
        pinned.map(async (m: any) => {
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

      const pinned = await tool.getPinnedMemories(context, 5);

      expect(pinned.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getPinStats', () => {
    it('고정 통계를 반환해야 함', async () => {
      createTestMemory(db, { content: 'Memory 1', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Memory 2', type: 'episodic', pinned: true });
      createTestMemory(db, { content: 'Memory 3', type: 'episodic', pinned: false });

      const stats = await tool.getPinStats(context);

      expect(stats).toHaveProperty('total_memories');
      expect(stats).toHaveProperty('pinned_count');
      expect(stats).toHaveProperty('unpinned_count');
      expect(stats.total_memories).toBe(3);
      expect(stats.pinned_count).toBe(2);
      expect(stats.unpinned_count).toBe(1);
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

    it('우선순위가 범위를 벗어나면 에러를 던져야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic',
        pinned: false
      });

      await expect(
        tool.handle({ id: memoryId, priority: 0 }, context)
      ).rejects.toThrow();

      await expect(
        tool.handle({ id: memoryId, priority: 6 }, context)
      ).rejects.toThrow();
    });
  });
});

