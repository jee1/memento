/**
 * Meta Memory Service 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryService } from './meta-memory-service.js';
import { WriteCoalescingManager } from '../../../shared/utils/write-coalescing.js';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import type { RecallResultItem } from '../tools/recall-tool.js';

/**
 * 기본 스키마 생성 (memory_item 테이블만)
 */
function createBaseSchema(db: Database.Database): void {
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
      origin_source TEXT DEFAULT '{}',
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT
    );
  `);

  // memento_schema_version 테이블 생성 (마이그레이션 버전 관리용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);
}

describe('MetaMemoryService', () => {
  let db: Database.Database;
  let service: MetaMemoryService;
  let writeCoalescingManager: WriteCoalescingManager;
  let flushCallback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);

    // meta_memory_stats 테이블 마이그레이션 실행
    const migration = new MetaMemoryStatsSchemaMigration();
    await migration.up(db);

    // 테스트용 memory_item 레코드 생성 (외래 키 제약 조건을 위해)
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
      VALUES 
        ('mem_1', 'episodic', 'Test content 1', 0.8, 'private', CURRENT_TIMESTAMP, 0),
        ('mem_2', 'semantic', 'Test content 2', 0.7, 'private', CURRENT_TIMESTAMP, 0),
        ('mem_success', 'episodic', 'Success content', 0.8, 'private', CURRENT_TIMESTAMP, 0),
        ('mem_failure', 'episodic', 'Failure content', 0.8, 'private', CURRENT_TIMESTAMP, 0),
        ('mem_confidence', 'episodic', 'Confidence content', 0.8, 'private', CURRENT_TIMESTAMP, 0)
    `);

    // WriteCoalescingManager 초기화
    flushCallback = vi.fn().mockResolvedValue(undefined);
    writeCoalescingManager = new WriteCoalescingManager(100, flushCallback);

    service = new MetaMemoryService(db, writeCoalescingManager);
  });

  afterEach(async () => {
    if (writeCoalescingManager) {
      await writeCoalescingManager.destroy();
    }
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('recordRecall', () => {
    it('given: 검색 결과 항목이 있을 때, when: recordRecall을 호출하면, then: 통계가 올바르게 업데이트되어야 함', async () => {
      // Given: 검색 결과 항목 준비
      const searchResults: RecallResultItem[] = [
        {
          memory_id: 'mem_1',
          content: 'Test content 1',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.95, // 성공 (>= 0.5)
          consolidation_score: 0.8,
          vectorScore: 0.9
        },
        {
          memory_id: 'mem_2',
          content: 'Test content 2',
          type: 'semantic',
          importance: 0.7,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.3, // 실패 (< 0.5)
          consolidation_score: 0.2,
          vectorScore: 0.4
        }
      ];

      // When: recordRecall 호출
      await service.recordRecall(searchResults);

      // Then: debounce 시간 후 데이터베이스에 업데이트가 반영되어야 함
      // flush를 수동으로 호출하여 버퍼 내용 확인
      await service.destroy(); // destroy 시 flush 호출

      // 데이터베이스에서 통계 확인
      const mem1Stats = await service.getStatsById('mem_1');
      expect(mem1Stats.recall_count).toBe(1);
      expect(mem1Stats.success_count).toBe(1);
      expect(mem1Stats.failure_count).toBe(0);
      expect(mem1Stats.avg_confidence).toBeGreaterThan(0);

      const mem2Stats = await service.getStatsById('mem_2');
      expect(mem2Stats.recall_count).toBe(1);
      expect(mem2Stats.success_count).toBe(0);
      expect(mem2Stats.failure_count).toBe(1);
      expect(mem2Stats.avg_confidence).toBeGreaterThan(0);
    });

    it('given: 검색 결과가 0개일 때, when: recordRecall을 호출하면, then: 통계 업데이트가 발생하지 않아야 함', async () => {
      // Given: 빈 검색 결과
      const searchResults: RecallResultItem[] = [];

      // When: recordRecall 호출
      await service.recordRecall(searchResults);

      // Then: 통계 업데이트가 발생하지 않아야 함
      await service.destroy(); // flush 확인

      // 데이터베이스에 통계가 없어야 함 (또는 변경되지 않아야 함)
      // 빈 검색 결과이므로 통계 업데이트가 없어야 함
    });

    it('given: final_score가 0.5 이상인 항목이 있을 때, when: recordRecall을 호출하면, then: success_count가 증가해야 함', async () => {
      // Given: 성공한 검색 결과 (final_score >= 0.5)
      const searchResults: RecallResultItem[] = [
        {
          memory_id: 'mem_success',
          content: 'Success content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.75, // 성공
          consolidation_score: 0.7,
          vectorScore: 0.8
        }
      ];

      // When: recordRecall 호출
      await service.recordRecall(searchResults);

      // Then: success_count가 증가해야 함
      await service.destroy(); // flush 확인

      const stats = await service.getStatsById('mem_success');
      expect(stats.recall_count).toBe(1);
      expect(stats.success_count).toBe(1);
      expect(stats.failure_count).toBe(0);
    });

    it('given: final_score가 0.5 미만인 항목이 있을 때, when: recordRecall을 호출하면, then: failure_count가 증가해야 함', async () => {
      // Given: 실패한 검색 결과 (final_score < 0.5)
      const searchResults: RecallResultItem[] = [
        {
          memory_id: 'mem_failure',
          content: 'Failure content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.3, // 실패
          consolidation_score: 0.2,
          vectorScore: 0.4
        }
      ];

      // When: recordRecall 호출
      await service.recordRecall(searchResults);

      // Then: failure_count가 증가해야 함
      await service.destroy(); // flush 확인

      const stats = await service.getStatsById('mem_failure');
      expect(stats.recall_count).toBe(1);
      expect(stats.success_count).toBe(0);
      expect(stats.failure_count).toBe(1);
    });

    it('given: confidence 점수가 계산되어야 할 때, when: recordRecall을 호출하면, then: confidence 점수가 올바르게 계산되어야 함', async () => {
      // Given: 검색 결과 (final_score, consolidation_score, vectorScore 포함)
      const searchResults: RecallResultItem[] = [
        {
          memory_id: 'mem_confidence',
          content: 'Confidence content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.8, // 0.6 * 0.8 = 0.48
          consolidation_score: 0.7, // 0.3 * 0.7 = 0.21
          vectorScore: 0.9 // 0.1 * 0.9 = 0.09
          // 예상 confidence: 0.48 + 0.21 + 0.09 = 0.78
        }
      ];

      // When: recordRecall 호출
      await service.recordRecall(searchResults);

      // Then: confidence 점수가 올바르게 계산되어야 함
      await service.destroy(); // flush 확인

      const stats = await service.getStatsById('mem_confidence');
      // 예상 confidence: 0.6 * 0.8 + 0.3 * 0.7 + 0.1 * 0.9 = 0.48 + 0.21 + 0.09 = 0.78
      const expectedConfidence = 0.6 * 0.8 + 0.3 * 0.7 + 0.1 * 0.9;
      expect(stats.avg_confidence).toBeCloseTo(expectedConfidence, 5);
    });
  });

  describe('calculateConfidence', () => {
    it('given: final_score, consolidation_score, vectorScore가 있을 때, when: calculateConfidence를 호출하면, then: 가중 평균이 올바르게 계산되어야 함', () => {
      // Given: 모든 점수가 있는 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0.8, // 0.6 * 0.8 = 0.48
        consolidation_score: 0.7, // 0.3 * 0.7 = 0.21
        vectorScore: 0.9 // 0.1 * 0.9 = 0.09
      } as any;

      // When: calculateConfidence 호출
      const confidence = service.calculateConfidence(item);

      // Then: 가중 평균이 올바르게 계산되어야 함
      // 예상값: 0.48 + 0.21 + 0.09 = 0.78
      const expected = 0.6 * 0.8 + 0.3 * 0.7 + 0.1 * 0.9;
      expect(confidence).toBeCloseTo(expected, 5);
      expect(confidence).toBeCloseTo(0.78, 5);
    });

    it('given: final_score만 있을 때, when: calculateConfidence를 호출하면, then: final_score만 사용하여 계산되어야 함', () => {
      // Given: final_score만 있는 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0.5
      } as any;

      // When: calculateConfidence 호출
      const confidence = service.calculateConfidence(item);

      // Then: final_score만 사용하여 계산 (0.6 * 0.5 = 0.3)
      expect(confidence).toBeCloseTo(0.3, 5);
    });

    it('given: finalScore (camelCase)가 있을 때, when: calculateConfidence를 호출하면, then: finalScore를 사용하여 계산되어야 함', () => {
      // Given: finalScore (camelCase)가 있는 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        finalScore: 0.6 // camelCase
      } as any;

      // When: calculateConfidence 호출
      const confidence = service.calculateConfidence(item);

      // Then: finalScore를 사용하여 계산 (0.6 * 0.6 = 0.36)
      expect(confidence).toBeCloseTo(0.36, 5);
    });

    it('given: 점수가 모두 0일 때, when: calculateConfidence를 호출하면, then: 0을 반환해야 함', () => {
      // Given: 모든 점수가 0인 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0,
        consolidation_score: 0,
        vectorScore: 0
      } as any;

      // When: calculateConfidence 호출
      const confidence = service.calculateConfidence(item);

      // Then: 0을 반환해야 함
      expect(confidence).toBe(0);
    });

    it('given: 점수가 모두 1.0일 때, when: calculateConfidence를 호출하면, then: 1.0을 반환해야 함', () => {
      // Given: 모든 점수가 1.0인 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 1.0,
        consolidation_score: 1.0,
        vectorScore: 1.0
      } as any;

      // When: calculateConfidence 호출
      const confidence = service.calculateConfidence(item);

      // Then: 1.0을 반환해야 함 (0.6 + 0.3 + 0.1 = 1.0)
      expect(confidence).toBeCloseTo(1.0, 5);
    });

    it('given: consolidation_score와 vectorScore가 없을 때, when: calculateConfidence를 호출하면, then: final_score만 사용하여 계산되어야 함', () => {
      // Given: final_score만 있는 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0.75
        // consolidation_score와 vectorScore 없음
      } as any;

      // When: calculateConfidence 호출
      const confidence = service.calculateConfidence(item);

      // Then: final_score만 사용하여 계산 (0.6 * 0.75 = 0.45)
      expect(confidence).toBeCloseTo(0.45, 5);
    });
  });

  describe('updateAvgConfidence', () => {
    it('given: 기존 평균과 새로운 confidence가 있을 때, when: updateAvgConfidence를 호출하면, then: 누적 평균이 올바르게 계산되어야 함', () => {
      // Given: 기존 평균과 새로운 confidence
      const currentAvg = 0.5; // 현재 평균 confidence
      const currentCount = 10; // 현재 recall_count
      const newConfidence = 0.8; // 새로운 confidence 점수

      // When: updateAvgConfidence 호출
      const newAvg = service.updateAvgConfidence(currentAvg, currentCount, newConfidence);

      // Then: 누적 평균이 올바르게 계산되어야 함
      // 총 confidence: 0.5 * 10 = 5.0
      // 새로운 총 confidence: 5.0 + 0.8 = 5.8
      // 새로운 평균: 5.8 / 11 = 0.527272...
      const expectedAvg = (0.5 * 10 + 0.8) / 11;
      expect(newAvg).toBeCloseTo(expectedAvg, 5);
      expect(newAvg).toBeCloseTo(0.52727, 5);
    });

    it('given: 첫 번째 recall일 때, when: updateAvgConfidence를 호출하면, then: 새로운 confidence가 그대로 평균이 되어야 함', () => {
      // Given: 첫 번째 recall (recall_count = 0)
      const currentAvg = 0.0; // 초기 평균
      const currentCount = 0; // 초기 recall_count
      const newConfidence = 0.75; // 첫 번째 confidence 점수

      // When: updateAvgConfidence 호출
      const newAvg = service.updateAvgConfidence(currentAvg, currentCount, newConfidence);

      // Then: 새로운 confidence가 그대로 평균이 되어야 함
      // 총 confidence: 0.0 * 0 = 0.0
      // 새로운 총 confidence: 0.0 + 0.75 = 0.75
      // 새로운 평균: 0.75 / 1 = 0.75
      expect(newAvg).toBeCloseTo(0.75, 5);
    });

    it('given: 여러 번의 recall이 있을 때, when: updateAvgConfidence를 연속 호출하면, then: 누적 평균이 올바르게 계산되어야 함', () => {
      // Given: 여러 번의 recall 시나리오
      let currentAvg = 0.0;
      let currentCount = 0;

      // 첫 번째 recall: confidence = 0.6
      currentAvg = service.updateAvgConfidence(currentAvg, currentCount, 0.6);
      currentCount = 1;
      expect(currentAvg).toBeCloseTo(0.6, 5);

      // 두 번째 recall: confidence = 0.8
      currentAvg = service.updateAvgConfidence(currentAvg, currentCount, 0.8);
      currentCount = 2;
      // 예상 평균: (0.6 + 0.8) / 2 = 0.7
      expect(currentAvg).toBeCloseTo(0.7, 5);

      // 세 번째 recall: confidence = 0.4
      currentAvg = service.updateAvgConfidence(currentAvg, currentCount, 0.4);
      currentCount = 3;
      // 예상 평균: (0.6 + 0.8 + 0.4) / 3 = 0.6
      expect(currentAvg).toBeCloseTo(0.6, 5);
    });

    it('given: 기존 평균이 0일 때, when: updateAvgConfidence를 호출하면, then: 새로운 confidence가 평균에 반영되어야 함', () => {
      // Given: 기존 평균이 0 (아직 recall이 없었거나 모두 0)
      const currentAvg = 0.0;
      const currentCount = 5; // recall_count는 있지만 평균이 0
      const newConfidence = 0.9; // 새로운 confidence 점수

      // When: updateAvgConfidence 호출
      const newAvg = service.updateAvgConfidence(currentAvg, currentCount, newConfidence);

      // Then: 새로운 confidence가 평균에 반영되어야 함
      // 총 confidence: 0.0 * 5 = 0.0
      // 새로운 총 confidence: 0.0 + 0.9 = 0.9
      // 새로운 평균: 0.9 / 6 = 0.15
      expect(newAvg).toBeCloseTo(0.15, 5);
    });

    it('given: 새로운 confidence가 0일 때, when: updateAvgConfidence를 호출하면, then: 평균이 감소해야 함', () => {
      // Given: 기존 평균이 높고 새로운 confidence가 0
      const currentAvg = 0.8;
      const currentCount = 10;
      const newConfidence = 0.0; // 실패한 recall

      // When: updateAvgConfidence 호출
      const newAvg = service.updateAvgConfidence(currentAvg, currentCount, newConfidence);

      // Then: 평균이 감소해야 함
      // 총 confidence: 0.8 * 10 = 8.0
      // 새로운 총 confidence: 8.0 + 0.0 = 8.0
      // 새로운 평균: 8.0 / 11 = 0.72727...
      const expectedAvg = (0.8 * 10 + 0.0) / 11;
      expect(newAvg).toBeCloseTo(expectedAvg, 5);
      expect(newAvg).toBeLessThan(currentAvg);
    });
  });

  describe('isItemSuccess', () => {
    it('given: final_score가 0.5 이상일 때, when: isItemSuccess를 호출하면, then: true를 반환해야 함', () => {
      // Given: final_score가 0.5 이상인 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0.75 // 0.5 이상
      };

      // When: isItemSuccess 호출
      const result = service.isItemSuccess(item);

      // Then: true를 반환해야 함
      expect(result).toBe(true);
    });

    it('given: final_score가 0.5 미만일 때, when: isItemSuccess를 호출하면, then: false를 반환해야 함', () => {
      // Given: final_score가 0.5 미만인 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0.3 // 0.5 미만
      };

      // When: isItemSuccess 호출
      const result = service.isItemSuccess(item);

      // Then: false를 반환해야 함
      expect(result).toBe(false);
    });

    it('given: final_score가 정확히 0.5일 때, when: isItemSuccess를 호출하면, then: true를 반환해야 함', () => {
      // Given: final_score가 정확히 0.5인 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        final_score: 0.5 // 정확히 0.5
      };

      // When: isItemSuccess 호출
      const result = service.isItemSuccess(item);

      // Then: true를 반환해야 함 (>= 0.5)
      expect(result).toBe(true);
    });

    it('given: final_score가 없을 때, when: isItemSuccess를 호출하면, then: false를 반환해야 함', () => {
      // Given: final_score가 없는 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z'
        // final_score 없음 (기본값 0)
      };

      // When: isItemSuccess 호출
      const result = service.isItemSuccess(item);

      // Then: false를 반환해야 함 (0 < 0.5)
      expect(result).toBe(false);
    });

    it('given: finalScore (camelCase)가 있을 때, when: isItemSuccess를 호출하면, then: finalScore를 사용하여 판정해야 함', () => {
      // Given: finalScore (camelCase)가 있는 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        finalScore: 0.8 // camelCase, 0.5 이상
      } as any;

      // When: isItemSuccess 호출
      const result = service.isItemSuccess(item);

      // Then: true를 반환해야 함
      expect(result).toBe(true);
    });

    it('given: finalScore (camelCase)가 0.5 미만일 때, when: isItemSuccess를 호출하면, then: false를 반환해야 함', () => {
      // Given: finalScore (camelCase)가 0.5 미만인 검색 결과 항목
      const item: RecallResultItem = {
        memory_id: 'mem_test',
        content: 'Test content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        finalScore: 0.3 // camelCase, 0.5 미만
      } as any;

      // When: isItemSuccess 호출
      const result = service.isItemSuccess(item);

      // Then: false를 반환해야 함
      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      // 테스트용 meta_memory_stats 데이터 생성
      const testStats = [
        {
          memory_id: 'mem_filter_1',
          recall_count: 10,
          success_count: 8,
          failure_count: 2,
          avg_confidence: 0.85,
          last_recalled_at: '2024-01-01T00:00:00.000Z'
        },
        {
          memory_id: 'mem_filter_2',
          recall_count: 5,
          success_count: 3,
          failure_count: 2,
          avg_confidence: 0.6,
          last_recalled_at: '2024-01-02T00:00:00.000Z'
        },
        {
          memory_id: 'mem_filter_3',
          recall_count: 20,
          success_count: 15,
          failure_count: 5,
          avg_confidence: 0.9,
          last_recalled_at: '2024-01-03T00:00:00.000Z'
        },
        {
          memory_id: 'mem_filter_4',
          recall_count: 3,
          success_count: 1,
          failure_count: 2,
          avg_confidence: 0.3,
          last_recalled_at: '2024-01-04T00:00:00.000Z'
        }
      ];

      // memory_item 레코드 생성 (외래 키 제약 조건)
      const insertMemoryStmt = db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES (?, 'episodic', 'Test content', 0.8, 'private', CURRENT_TIMESTAMP, 0)
      `);

      const insertStatsStmt = db.prepare(`
        INSERT INTO meta_memory_stats (
          memory_id, recall_count, success_count, failure_count, 
          avg_confidence, last_recalled_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const stat of testStats) {
        insertMemoryStmt.run(stat.memory_id);
        insertStatsStmt.run(
          stat.memory_id,
          stat.recall_count,
          stat.success_count,
          stat.failure_count,
          stat.avg_confidence,
          stat.last_recalled_at
        );
      }
    });

    it('given: 다양한 필터 조건이 있을 때, when: getStats를 호출하면, then: 필터링된 결과가 반환되어야 함', async () => {
      // Given: 다양한 필터 조건
      const params = {
        min_recall_count: 10,
        min_confidence: 0.7,
        limit: 10
      };

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: 필터링된 결과가 반환되어야 함
      // mem_filter_1: recall_count=10, avg_confidence=0.85 (포함)
      // mem_filter_2: recall_count=5, avg_confidence=0.6 (제외: recall_count < 10)
      // mem_filter_3: recall_count=20, avg_confidence=0.9 (포함)
      // mem_filter_4: recall_count=3, avg_confidence=0.3 (제외: recall_count < 10, avg_confidence < 0.7)
      // 예상 결과: mem_filter_1, mem_filter_3 (2개)
      expect(result.items.length).toBe(2);
      expect(result.total_count).toBe(2);
      expect(result.items.map(i => i.memory_id)).toContain('mem_filter_1');
      expect(result.items.map(i => i.memory_id)).toContain('mem_filter_3');
    });

    it('given: memory_id 필터가 있을 때, when: getStats를 호출하면, then: 특정 메모리의 통계가 반환되어야 함', async () => {
      // Given: memory_id 필터
      const params = {
        memory_id: 'mem_filter_1'
      };

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: 특정 메모리의 통계가 반환되어야 함
      expect(result.items.length).toBe(1);
      expect(result.items[0].memory_id).toBe('mem_filter_1');
      expect(result.items[0].recall_count).toBe(10);
      expect(result.total_count).toBe(1);
    });

    it('given: memory_ids 필터가 있을 때, when: getStats를 호출하면, then: 여러 메모리의 통계가 반환되어야 함', async () => {
      // Given: memory_ids 필터
      const params = {
        memory_ids: ['mem_filter_1', 'mem_filter_2']
      };

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: 여러 메모리의 통계가 반환되어야 함
      expect(result.items.length).toBe(2);
      expect(result.items.map(i => i.memory_id)).toContain('mem_filter_1');
      expect(result.items.map(i => i.memory_id)).toContain('mem_filter_2');
      expect(result.total_count).toBe(2);
    });

    it('given: min_recall_count 필터가 있을 때, when: getStats를 호출하면, then: recall_count가 최소값 이상인 통계만 반환되어야 함', async () => {
      // Given: min_recall_count 필터
      const params = {
        min_recall_count: 10
      };

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: recall_count >= 10인 통계만 반환되어야 함
      // mem_filter_1: recall_count=10 (포함)
      // mem_filter_3: recall_count=20 (포함)
      // mem_filter_2: recall_count=5 (제외)
      // mem_filter_4: recall_count=3 (제외)
      expect(result.items.length).toBe(2);
      expect(result.items.every(i => i.recall_count >= 10)).toBe(true);
      expect(result.total_count).toBe(2);
    });

    it('given: min_confidence 필터가 있을 때, when: getStats를 호출하면, then: avg_confidence가 최소값 이상인 통계만 반환되어야 함', async () => {
      // Given: min_confidence 필터
      const params = {
        min_confidence: 0.7
      };

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: avg_confidence >= 0.7인 통계만 반환되어야 함
      // mem_filter_1: avg_confidence=0.85 (포함)
      // mem_filter_3: avg_confidence=0.9 (포함)
      // mem_filter_2: avg_confidence=0.6 (제외)
      // mem_filter_4: avg_confidence=0.3 (제외)
      expect(result.items.length).toBe(2);
      expect(result.items.every(i => i.avg_confidence >= 0.7)).toBe(true);
      expect(result.total_count).toBe(2);
    });

    it('given: limit 필터가 있을 때, when: getStats를 호출하면, then: 결과가 limit 개수로 제한되어야 함', async () => {
      // Given: limit 필터
      const params = {
        limit: 2
      };

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: 결과가 limit 개수로 제한되어야 함
      expect(result.items.length).toBeLessThanOrEqual(2);
      // total_count는 필터링된 전체 개수 (limit과 무관)
      expect(result.total_count).toBe(4);
    });

    it('given: 필터 조건이 없을 때, when: getStats를 호출하면, then: 모든 통계가 반환되어야 함', async () => {
      // Given: 필터 조건 없음
      const params = {};

      // When: getStats 호출
      const result = await service.getStats(params);

      // Then: 모든 통계가 반환되어야 함 (limit 기본값 100)
      expect(result.items.length).toBe(4);
      expect(result.total_count).toBe(4);
    });
  });

  describe('Debounce 처리 통합 테스트', () => {
    beforeEach(async () => {
      // 테스트용 memory_item 레코드 생성
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES ('mem_debounce', 'episodic', 'Debounce test content', 0.8, 'private', CURRENT_TIMESTAMP, 0)
      `);
    });

    it('given: 짧은 시간 내 연속된 recall 호출이 있을 때, when: 통계를 확인하면, then: 마지막 업데이트만 반영되어야 함', async () => {
      // Given: 짧은 시간 내 연속된 recall 호출
      const searchResults1: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.6, // 첫 번째 호출
          consolidation_score: 0.5,
          vectorScore: 0.7
        }
      ];

      const searchResults2: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.8, // 두 번째 호출 (마지막)
          consolidation_score: 0.7,
          vectorScore: 0.9
        }
      ];

      // When: 짧은 시간 내 연속 호출 (100ms 이내)
      await service.recordRecall(searchResults1);
      await service.recordRecall(searchResults2);

      // debounce 시간 대기 (100ms + 여유 시간)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Then: 마지막 업데이트만 반영되어야 함
      // 두 번째 호출의 통계만 반영되어야 함 (recall_count = 1)
      const stats = await service.getStatsById('mem_debounce');
      expect(stats.recall_count).toBe(1); // 마지막 업데이트만 반영
      expect(stats.success_count).toBe(1); // final_score = 0.8 >= 0.5
    });

    it('given: 같은 memory_id에 대한 연속 업데이트가 있을 때, when: 통계를 확인하면, then: 마지막 업데이트만 실행되어야 함', async () => {
      // Given: 같은 memory_id에 대한 여러 업데이트
      const searchResults1: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.3, // 첫 번째: 실패
          consolidation_score: 0.2,
          vectorScore: 0.4
        }
      ];

      const searchResults2: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.7, // 두 번째: 성공
          consolidation_score: 0.6,
          vectorScore: 0.8
        }
      ];

      const searchResults3: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.9, // 세 번째: 성공 (마지막)
          consolidation_score: 0.8,
          vectorScore: 0.95
        }
      ];

      // When: 연속 호출 (100ms 이내)
      await service.recordRecall(searchResults1);
      await service.recordRecall(searchResults2);
      await service.recordRecall(searchResults3);

      // debounce 시간 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // Then: 마지막 업데이트만 실행되어야 함
      const stats = await service.getStatsById('mem_debounce');
      expect(stats.recall_count).toBe(1); // 마지막 업데이트만 반영
      expect(stats.success_count).toBe(1); // 마지막 호출이 성공
      expect(stats.failure_count).toBe(0); // 첫 번째 호출은 반영되지 않음
    });

    it('given: debounce 시간 이후에 recall 호출이 있을 때, when: 통계를 확인하면, then: 각각 별도로 업데이트되어야 함', async () => {
      // Given: debounce 시간 이후의 호출
      const searchResults1: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.6,
          consolidation_score: 0.5,
          vectorScore: 0.7
        }
      ];

      const searchResults2: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.8,
          consolidation_score: 0.7,
          vectorScore: 0.9
        }
      ];

      // When: 첫 번째 호출
      await service.recordRecall(searchResults1);

      // debounce 시간 대기 (100ms + 여유 시간)
      await new Promise(resolve => setTimeout(resolve, 150));

      // 두 번째 호출 (debounce 시간 이후)
      await service.recordRecall(searchResults2);

      // debounce 시간 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // Then: 각각 별도로 업데이트되어야 함
      const stats = await service.getStatsById('mem_debounce');
      expect(stats.recall_count).toBe(2); // 두 번 모두 반영
      expect(stats.success_count).toBe(2); // 둘 다 성공
    });

    it('given: 여러 memory_id에 대한 연속 업데이트가 있을 때, when: 통계를 확인하면, then: 각 memory_id의 마지막 업데이트만 반영되어야 함', async () => {
      // Given: 여러 memory_id에 대한 업데이트
      // memory_item 레코드 추가 생성
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES ('mem_debounce_2', 'episodic', 'Debounce test content 2', 0.8, 'private', CURRENT_TIMESTAMP, 0)
      `);

      const searchResults1: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.3, // 첫 번째 호출
          consolidation_score: 0.2,
          vectorScore: 0.4
        },
        {
          memory_id: 'mem_debounce_2',
          content: 'Test content 2',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.4, // 첫 번째 호출
          consolidation_score: 0.3,
          vectorScore: 0.5
        }
      ];

      const searchResults2: RecallResultItem[] = [
        {
          memory_id: 'mem_debounce',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.8, // 두 번째 호출 (마지막)
          consolidation_score: 0.7,
          vectorScore: 0.9
        },
        {
          memory_id: 'mem_debounce_2',
          content: 'Test content 2',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          final_score: 0.9, // 두 번째 호출 (마지막)
          consolidation_score: 0.8,
          vectorScore: 0.95
        }
      ];

      // When: 연속 호출 (100ms 이내)
      await service.recordRecall(searchResults1);
      await service.recordRecall(searchResults2);

      // debounce 시간 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // Then: 각 memory_id의 마지막 업데이트만 반영되어야 함
      const stats1 = await service.getStatsById('mem_debounce');
      expect(stats1.recall_count).toBe(1); // 마지막 업데이트만 반영
      expect(stats1.success_count).toBe(1); // 마지막 호출이 성공

      const stats2 = await service.getStatsById('mem_debounce_2');
      expect(stats2.recall_count).toBe(1); // 마지막 업데이트만 반영
      expect(stats2.success_count).toBe(1); // 마지막 호출이 성공
    });
  });
});
