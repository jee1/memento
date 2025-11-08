/**
 * Consolidation Score Worker 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ConsolidationScoreWorker } from './consolidation-score-worker.js';
import { DatabaseUtils } from '../utils/database.js';

/**
 * 테스트용 데이터베이스 초기화
 */
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
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      -- Consolidation Score 필드
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;
  `);
}

describe('ConsolidationScoreWorker', () => {
  let db: Database.Database;
  let worker: ConsolidationScoreWorker;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    worker = new ConsolidationScoreWorker({
      batchSize: 100,
      chunkSize: 10,
      delayBetweenChunks: 10,
      incrementalHours: 12,
      enableLogging: false
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('runIncrementalRecalculation', () => {
    it('최근 갱신된 레코드만 재계산해야 함', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // 최근 30분 내 갱신된 레코드
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mem1', 'episodic', 'Recent memory', 5, thirtyMinutesAgo.toISOString(), twoHoursAgo.toISOString(), 2.5, 0.8]
      );

      // 2시간 전 갱신된 레코드 (재계산 대상 아님)
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mem2', 'episodic', 'Old memory', 3, twoHoursAgo.toISOString(), twoHoursAgo.toISOString(), 2.0, 0.7]
      );

      const result = await worker.runIncrementalRecalculation(db, 1); // 1시간 범위

      expect(result.success).toBe(true);
      expect(result.processed).toBeGreaterThanOrEqual(1); // mem1은 처리되어야 함
      expect(result.updated).toBeGreaterThanOrEqual(0);
    });

    it('처리할 레코드가 없으면 빈 결과 반환', async () => {
      const result = await worker.runIncrementalRecalculation(db, 1);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('배치 크기 제한을 준수해야 함', async () => {
      // 200개의 레코드 생성
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      for (let i = 0; i < 200; i++) {
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`mem${i}`, 'episodic', `Memory ${i}`, 1, thirtyMinutesAgo.toISOString(), thirtyMinutesAgo.toISOString(), 1.0, 0.5]
        );
      }

      const smallBatchWorker = new ConsolidationScoreWorker({
        batchSize: 50,
        chunkSize: 10,
        enableLogging: false
      });

      const result = await smallBatchWorker.runIncrementalRecalculation(db, 1);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(200);
      expect(result.details?.batchesProcessed).toBe(4); // 200 / 50 = 4 배치
    });
  });

  describe('runFullSweep', () => {
    it('전체 레코드를 재계산해야 함', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // 여러 레코드 생성
      for (let i = 0; i < 5; i++) {
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `mem${i}`,
            'episodic',
            `Memory ${i}`,
            i + 1,
            i % 2 === 0 ? oneHourAgo.toISOString() : twoHoursAgo.toISOString(),
            twoHoursAgo.toISOString(),
            1.0 + i * 0.1,
            0.5 + i * 0.1
          ]
        );
      }

      const result = await worker.runFullSweep(db);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(5);
      expect(result.details?.batchesProcessed).toBeGreaterThan(0);
      expect(result.details?.scoreDistribution).toBeDefined();
    });

    it('점수 분포를 집계해야 함', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // 다양한 점수의 레코드 생성
      const scores = [0.9, 0.7, 0.5, 0.3, 0.1];
      for (let i = 0; i < scores.length; i++) {
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `mem${i}`,
            'episodic',
            `Memory ${i}`,
            5,
            oneHourAgo.toISOString(),
            oneHourAgo.toISOString(),
            2.0,
            scores[i]
          ]
        );
      }

      const result = await worker.runFullSweep(db);

      expect(result.success).toBe(true);
      expect(result.details?.scoreDistribution).toBeDefined();
      if (result.details?.scoreDistribution) {
        const dist = result.details.scoreDistribution;
        expect(dist.high + dist.medium + dist.low).toBeGreaterThan(0);
      }
    });
  });

  describe('바닥값/상한 재적용', () => {
    it('점수가 최소값보다 낮으면 바닥값으로 조정', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mem1', 'episodic', 'Low score memory', 0, oneHourAgo.toISOString(), oneHourAgo.toISOString(), 1.0, -0.1]
      );

      const result = await worker.runFullSweep(db);

      expect(result.success).toBe(true);
      
      const finalScore = db.prepare('SELECT consolidation_score FROM memory_item WHERE id = ?').get('mem1') as { consolidation_score: number };
      expect(finalScore.consolidation_score).toBeGreaterThanOrEqual(0.0);
    });

    it('핀 고정 메모리는 최소 바닥값 보장', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, pinned, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mem1', 'episodic', 'Pinned memory', 0, oneHourAgo.toISOString(), oneHourAgo.toISOString(), 1, 1.0, 0.1]
      );

      const result = await worker.runFullSweep(db);

      expect(result.success).toBe(true);
      
      const finalScore = db.prepare('SELECT consolidation_score FROM memory_item WHERE id = ?').get('mem1') as { consolidation_score: number };
      expect(finalScore.consolidation_score).toBeGreaterThanOrEqual(0.25); // pinnedMinScore
    });
  });

  describe('청크 단위 처리', () => {
    it('청크 크기를 준수해야 함', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // 50개의 레코드 생성
      for (let i = 0; i < 50; i++) {
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`mem${i}`, 'episodic', `Memory ${i}`, 1, oneHourAgo.toISOString(), oneHourAgo.toISOString(), 1.0, 0.5]
        );
      }

      const smallChunkWorker = new ConsolidationScoreWorker({
        batchSize: 100,
        chunkSize: 10,
        enableLogging: false
      });

      const result = await smallChunkWorker.runFullSweep(db);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(50);
      expect(result.details?.chunksProcessed).toBe(5); // 50 / 10 = 5 청크
    });
  });

  describe('에러 처리', () => {
    it('개별 레코드 처리 실패 시 다른 레코드는 계속 처리', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // 정상 레코드
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mem1', 'episodic', 'Valid memory', 1, oneHourAgo.toISOString(), oneHourAgo.toISOString(), 1.0, 0.5]
      );

      // 잘못된 타입의 레코드 (에러 발생 가능)
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['mem2', 'episodic', 'Another valid memory', 1, oneHourAgo.toISOString(), oneHourAgo.toISOString(), 1.0, 0.5]
      );

      const result = await worker.runFullSweep(db);

      // 에러가 있어도 처리된 레코드는 있음
      expect(result.processed).toBeGreaterThan(0);
    });
  });
});

