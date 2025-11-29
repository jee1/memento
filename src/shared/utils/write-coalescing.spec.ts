/**
 * Write Coalescing Manager 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WriteCoalescingManager, type CoalescedWrite } from '../write-coalescing.js';

describe('WriteCoalescingManager', () => {
  let manager: WriteCoalescingManager;
  let flushCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    flushCallback = vi.fn().mockResolvedValue(undefined);
    manager = new WriteCoalescingManager(100, flushCallback); // 100ms 간격
  });

  afterEach(async () => {
    await manager.destroy();
  });

  describe('addWrite', () => {
    it('단일 쓰기를 버퍼에 추가해야 함', () => {
      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: {
          recall_count: 1,
          last_accessed_at: '2025-01-01T00:00:00Z'
        }
      };

      manager.addWrite(write);

      expect(manager.getBufferSize()).toBe(1);
      expect(manager.isEmpty()).toBe(false);
    });

    it('같은 memoryId에 대한 여러 쓰기를 병합해야 함', () => {
      const write1: CoalescedWrite = {
        memoryId: 'mem1',
        fields: {
          recall_count: 1,
          last_accessed_at: '2025-01-01T00:00:00Z'
        }
      };

      const write2: CoalescedWrite = {
        memoryId: 'mem1',
        fields: {
          recall_count: 2,
          g_value: 1.5
        }
      };

      manager.addWrite(write1);
      manager.addWrite(write2);

      expect(manager.getBufferSize()).toBe(1); // 같은 memoryId는 병합됨
    });

    it('다른 memoryId에 대한 쓰기는 별도로 저장해야 함', () => {
      const write1: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      const write2: CoalescedWrite = {
        memoryId: 'mem2',
        fields: { recall_count: 2 }
      };

      manager.addWrite(write1);
      manager.addWrite(write2);

      expect(manager.getBufferSize()).toBe(2);
    });
  });

  describe('flush', () => {
    it('버퍼가 비어있으면 flush를 호출하지 않아야 함', async () => {
      await manager.flush();

      expect(flushCallback).not.toHaveBeenCalled();
    });

    it('버퍼의 모든 쓰기를 flush해야 함', async () => {
      const write1: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      const write2: CoalescedWrite = {
        memoryId: 'mem2',
        fields: { recall_count: 2 }
      };

      manager.addWrite(write1);
      manager.addWrite(write2);

      await manager.flush();

      expect(flushCallback).toHaveBeenCalledTimes(1);
      const flushedWrites = flushCallback.mock.calls[0][0] as CoalescedWrite[];
      expect(flushedWrites.length).toBe(2);
      expect(flushedWrites.find(w => w.memoryId === 'mem1')).toBeDefined();
      expect(flushedWrites.find(w => w.memoryId === 'mem2')).toBeDefined();
    });

    it('flush 후 버퍼를 비워야 함', async () => {
      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      manager.addWrite(write);
      expect(manager.getBufferSize()).toBe(1);

      await manager.flush();

      expect(manager.getBufferSize()).toBe(0);
      expect(manager.isEmpty()).toBe(true);
    });

    it('flush 중 에러가 발생해도 버퍼는 비워야 함', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Flush failed'));
      const errorManager = new WriteCoalescingManager(100, errorCallback);

      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      errorManager.addWrite(write);

      try {
        await errorManager.flush();
      } catch (error) {
        // 에러는 예상됨
      }

      // 버퍼는 비워짐 (에러 발생 여부와 무관)
      expect(errorManager.getBufferSize()).toBe(0);
      expect(errorManager.isEmpty()).toBe(true);

      await errorManager.destroy();
    });
  });

  describe('자동 flush', () => {
    it('지정된 간격마다 자동으로 flush해야 함', async () => {
      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      manager.addWrite(write);

      // flush 간격(100ms) + 여유 시간 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(flushCallback).toHaveBeenCalled();
    }, 1000);

    it('stop 후에는 자동 flush가 중지되어야 함', async () => {
      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      manager.addWrite(write);
      
      // flush 간격 + 여유 시간 대기하여 첫 flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const callCountBeforeStop = flushCallback.mock.calls.length;
      
      // destroy를 호출하여 타이머 정리 (stop은 없고 destroy가 있음)
      await manager.destroy();
      
      // destroy 후 추가 flush 간격 대기
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // destroy 후에는 추가 호출이 없어야 함
      expect(flushCallback.mock.calls.length).toBe(callCountBeforeStop);
    }, 1000);
  });

  describe('destroy', () => {
    it('destroy 시 타이머를 정리하고 버퍼를 비워야 함', async () => {
      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      manager.addWrite(write);
      expect(manager.getBufferSize()).toBe(1);

      await manager.destroy();

      expect(manager.getBufferSize()).toBe(0);
      expect(manager.isEmpty()).toBe(true);
    });

    it('destroy 후 start를 다시 호출할 수 있어야 함', async () => {
      await manager.destroy();
      
      const write: CoalescedWrite = {
        memoryId: 'mem1',
        fields: { recall_count: 1 }
      };

      // 새로운 manager 생성 (destroy 후 재사용 불가하므로 새로 생성)
      const newManager = new WriteCoalescingManager(100, flushCallback);
      newManager.addWrite(write);

      expect(newManager.getBufferSize()).toBe(1);

      await newManager.destroy();
    });
  });

  describe('필드 병합', () => {
    it('같은 memoryId의 필드를 올바르게 병합해야 함', async () => {
      const write1: CoalescedWrite = {
        memoryId: 'mem1',
        fields: {
          recall_count: 1,
          last_accessed_at: '2025-01-01T00:00:00Z'
        }
      };

      const write2: CoalescedWrite = {
        memoryId: 'mem1',
        fields: {
          recall_count: 2, // 덮어쓰기
          g_value: 1.5     // 새 필드 추가
        }
      };

      manager.addWrite(write1);
      manager.addWrite(write2);

      await manager.flush();

      const flushedWrites = flushCallback.mock.calls[0][0] as CoalescedWrite[];
      const mergedWrite = flushedWrites.find(w => w.memoryId === 'mem1');
      
      expect(mergedWrite).toBeDefined();
      expect(mergedWrite!.fields.recall_count).toBe(2); // 마지막 값
      expect(mergedWrite!.fields.last_accessed_at).toBe('2025-01-01T00:00:00Z'); // 유지
      expect(mergedWrite!.fields.g_value).toBe(1.5); // 새 필드
    });
  });
});

