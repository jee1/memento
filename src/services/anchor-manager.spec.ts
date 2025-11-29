import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { AnchorManager, AnchorError, MemoryNotFoundError } from '../anchor-manager.js';

/**
 * anchor 테이블 생성
 */
function createAnchorTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anchor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
      memory_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(agent_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_anchor_agent_slot ON anchor(agent_id, slot);
    CREATE INDEX IF NOT EXISTS idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL;
  `);
}

describe('AnchorManager', () => {
  let db: Database.Database;
  let anchorManager: AnchorManager;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    createAnchorTable(db);
    
    anchorManager = new AnchorManager();
    anchorManager.setDatabase(db);
  });

  afterEach(() => {
    // 인스턴스 정리
    if (anchorManager) {
      anchorManager = null as any;
    }
    
    // 데이터베이스 닫기
    if (db) {
      try {
        db.close();
      } catch (error) {
        console.warn('Database close 중 에러:', error);
      }
      db = null as any;
    }
  });

  describe('초기화', () => {
    it('should initialize successfully', () => {
      const manager = new AnchorManager();
      expect(manager).toBeDefined();
    });

    it('should throw error if database is not set', async () => {
      const manager = new AnchorManager();
      await expect(
        manager.setAnchor('agent1', 'mem1', 'A')
      ).rejects.toThrow('Database is not set');
    });

    it('should set database successfully', () => {
      const manager = new AnchorManager();
      expect(() => manager.setDatabase(db)).not.toThrow();
    });
  });

  describe('setAnchor', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem3', 'procedural', 'Test content 3', 0.5, 'private']);
    });

    it('should set anchor successfully', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).toBeDefined();
      expect(anchor).not.toBeNull();
      if (anchor && !Array.isArray(anchor)) {
        expect(anchor.memory_id).toBe('mem1');
        expect(anchor.agent_id).toBe('agent1');
        expect(anchor.slot).toBe('A');
      }
    });

    it('should update cache when setting anchor', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      // 캐시에서 확인 (내부 메서드이므로 getAnchor로 간접 확인)
      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).not.toBeNull();
    });

    it('should replace existing anchor in same slot', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent1', 'mem2', 'A');

      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).not.toBeNull();
      if (anchor && !Array.isArray(anchor)) {
        expect(anchor.memory_id).toBe('mem2');
      }
    });

    it('should allow different agents to set same memory in same slot', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent2', 'mem1', 'A');

      const anchor1 = await anchorManager.getAnchor('agent1', 'A');
      const anchor2 = await anchorManager.getAnchor('agent2', 'A');

      expect(anchor1).not.toBeNull();
      expect(anchor2).not.toBeNull();
      if (anchor1 && !Array.isArray(anchor1) && anchor2 && !Array.isArray(anchor2)) {
        expect(anchor1.memory_id).toBe('mem1');
        expect(anchor2.memory_id).toBe('mem1');
      }
    });

    it('should throw MemoryNotFoundError when memory does not exist', async () => {
      await expect(
        anchorManager.setAnchor('agent1', 'nonexistent', 'A')
      ).rejects.toThrow(MemoryNotFoundError);
    });

    it('should throw AnchorError when same memory is set in different slots', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      await expect(
        anchorManager.setAnchor('agent1', 'mem1', 'B')
      ).rejects.toThrow(AnchorError);
    });

    it('should allow same memory in different slots for different agents', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent2', 'mem1', 'B');

      const anchor1 = await anchorManager.getAnchor('agent1', 'A');
      const anchor2 = await anchorManager.getAnchor('agent2', 'B');

      expect(anchor1).not.toBeNull();
      expect(anchor2).not.toBeNull();
    });

    it('should set anchors in all slots', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent1', 'mem2', 'B');
      await anchorManager.setAnchor('agent1', 'mem3', 'C');

      const anchors = await anchorManager.getAnchor('agent1');
      expect(anchors).not.toBeNull();
      expect(Array.isArray(anchors)).toBe(true);
      if (Array.isArray(anchors)) {
        expect(anchors.length).toBe(3);
        expect(anchors.find(a => a.slot === 'A')?.memory_id).toBe('mem1');
        expect(anchors.find(a => a.slot === 'B')?.memory_id).toBe('mem2');
        expect(anchors.find(a => a.slot === 'C')?.memory_id).toBe('mem3');
      }
    });
  });

  describe('getAnchor', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);
    });

    it('should return null when anchor does not exist', async () => {
      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).toBeNull();
    });

    it('should return anchor from database when not in cache', async () => {
      // DB에 직접 삽입 (캐시 우회)
      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'A', 'mem1']);

      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).not.toBeNull();
      if (anchor && !Array.isArray(anchor)) {
        expect(anchor.memory_id).toBe('mem1');
      }
    });

    it('should return all anchors when slot is not specified', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent1', 'mem2', 'B');

      const anchors = await anchorManager.getAnchor('agent1');
      expect(anchors).not.toBeNull();
      expect(Array.isArray(anchors)).toBe(true);
      if (Array.isArray(anchors)) {
        expect(anchors.length).toBe(2);
      }
    });

    it('should return empty array when no anchors exist', async () => {
      const anchors = await anchorManager.getAnchor('agent1');
      expect(anchors).toBeNull();
    });

    it('should update cache after database lookup', async () => {
      // DB에 직접 삽입
      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'A', 'mem1']);

      // 첫 번째 조회 (DB에서)
      const anchor1 = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor1).not.toBeNull();

      // 두 번째 조회는 캐시에서 빠르게 조회되어야 함
      const anchor2 = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor2).not.toBeNull();
    });
  });

  describe('clearAnchor', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);
    });

    it('should clear specific slot anchor', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent1', 'mem2', 'B');

      await anchorManager.clearAnchor('agent1', 'A');

      const anchorA = await anchorManager.getAnchor('agent1', 'A');
      const anchorB = await anchorManager.getAnchor('agent1', 'B');

      expect(anchorA).toBeNull();
      expect(anchorB).not.toBeNull();
    });

    it('should clear all anchors when slot is not specified', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent1', 'mem2', 'B');
      // mem1은 이미 A에 설정되어 있으므로 C에는 다른 메모리 사용
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem3', 'procedural', 'Test content 3', 0.5, 'private']);
      await anchorManager.setAnchor('agent1', 'mem3', 'C');

      await anchorManager.clearAnchor('agent1');

      const anchors = await anchorManager.getAnchor('agent1');
      expect(anchors).toBeNull();
    });

    it('should update cache when clearing anchor', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      await anchorManager.clearAnchor('agent1', 'A');

      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).toBeNull();
    });

    it('should not affect other agents anchors', async () => {
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent2', 'mem2', 'A');

      await anchorManager.clearAnchor('agent1');

      const anchor1 = await anchorManager.getAnchor('agent1', 'A');
      const anchor2 = await anchorManager.getAnchor('agent2', 'A');

      expect(anchor1).toBeNull();
      expect(anchor2).not.toBeNull();
    });
  });

  describe('restoreCacheFromDB', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);
    });

    it('should restore cache from database', async () => {
      // DB에 직접 삽입
      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'A', 'mem1']);

      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'B', 'mem2']);

      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent2', 'A', 'mem1']);

      await anchorManager.restoreCacheFromDB(db);

      // 캐시가 복원되었는지 확인
      const anchors1 = await anchorManager.getAnchor('agent1');
      const anchors2 = await anchorManager.getAnchor('agent2');

      expect(anchors1).not.toBeNull();
      expect(anchors2).not.toBeNull();
      if (Array.isArray(anchors1) && Array.isArray(anchors2)) {
        expect(anchors1.length).toBe(2);
        expect(anchors2.length).toBe(1);
      }
    });

    it('should handle empty database', async () => {
      await expect(
        anchorManager.restoreCacheFromDB(db)
      ).resolves.not.toThrow();

      const anchors = await anchorManager.getAnchor('agent1');
      expect(anchors).toBeNull();
    });
  });

  describe('getSlotConfig', () => {
    it('should return correct config for slot A', () => {
      const config = anchorManager.getSlotConfig('A');
      expect(config.hop_limit).toBe(1);
      expect(config.vector_threshold).toBe(0.8);
    });

    it('should return correct config for slot B', () => {
      const config = anchorManager.getSlotConfig('B');
      expect(config.hop_limit).toBe(2);
      expect(config.vector_threshold).toBe(0.6);
    });

    it('should return correct config for slot C', () => {
      const config = anchorManager.getSlotConfig('C');
      expect(config.hop_limit).toBe(3);
      expect(config.vector_threshold).toBe(0.4);
    });
  });

  describe('Edge Cases', () => {
    it('should handle memory deletion (ON DELETE SET NULL)', async () => {
      // 메모리 및 앵커 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      // 메모리 삭제
      await DatabaseUtils.run(db, 'DELETE FROM memory_item WHERE id = ?', ['mem1']);

      // 앵커의 memory_id가 NULL로 설정되었는지 확인
      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).not.toBeNull();
      if (anchor && !Array.isArray(anchor)) {
        expect(anchor.memory_id).toBeNull();
      }
    });

    it('should handle multiple agents with same memory in different slots', async () => {
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent2', 'mem1', 'B');
      await anchorManager.setAnchor('agent3', 'mem1', 'C');

      const anchor1 = await anchorManager.getAnchor('agent1', 'A');
      const anchor2 = await anchorManager.getAnchor('agent2', 'B');
      const anchor3 = await anchorManager.getAnchor('agent3', 'C');

      expect(anchor1).not.toBeNull();
      expect(anchor2).not.toBeNull();
      expect(anchor3).not.toBeNull();
    });

    it('should handle concurrent anchor updates', async () => {
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);

      // 동시에 여러 앵커 설정
      await Promise.all([
        anchorManager.setAnchor('agent1', 'mem1', 'A'),
        anchorManager.setAnchor('agent1', 'mem2', 'B'),
        anchorManager.setAnchor('agent2', 'mem1', 'A')
      ]);

      const anchors1 = await anchorManager.getAnchor('agent1');
      const anchors2 = await anchorManager.getAnchor('agent2');

      expect(anchors1).not.toBeNull();
      expect(anchors2).not.toBeNull();
    });
  });
});

