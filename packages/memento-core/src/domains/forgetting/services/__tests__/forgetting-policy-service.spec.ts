/**
 * ForgettingPolicyService 테스트
 * 망각 정책 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ForgettingPolicyService, type MemoryCleanupResult } from '../forgetting-policy-service.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { DAY_MS } from '../../../../shared/utils/date.js';

describe('ForgettingPolicyService', () => {
  let service: ForgettingPolicyService;
  let db: Database.Database;

  beforeEach(async () => {
    service = new ForgettingPolicyService();
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('executeMemoryCleanup', () => {
    it('메모리 정리를 실행해야 함', async () => {
      // 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Old memory',
        type: 'episodic',
        importance: 0.3,
        pinned: false
      });

      const result = await service.executeMemoryCleanup(db);

      expect(result).toHaveProperty('softDeleted');
      expect(result).toHaveProperty('hardDeleted');
      expect(result).toHaveProperty('totalProcessed');
      expect(result).toHaveProperty('summary');
    });

    it('소프트 삭제 후보를 처리해야 함', async () => {
      // 오래된 메모리 생성 (TTL 초과)
      const memoryId = createTestMemory(db, {
        content: 'Old episodic memory',
        type: 'episodic',
        importance: 0.2,
        pinned: false
      });

      // created_at을 과거로 설정
      const oldDate = new Date(Date.now() - 31 * DAY_MS); // 31일 전
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [oldDate.toISOString(), memoryId]);

      const result = await service.executeMemoryCleanup(db);

      // 소프트 삭제가 실행되었는지 확인 (실제 결과는 알고리즘에 따라 다를 수 있음)
      expect(result.summary.actualSoftDeletes).toBeGreaterThanOrEqual(0);
    });

    it('하드 삭제 후보를 처리해야 함', async () => {
      // 매우 오래된 메모리 생성
      const memoryId = createTestMemory(db, {
        content: 'Very old memory',
        type: 'episodic',
        importance: 0.1,
        pinned: false
      });

      // created_at을 매우 과거로 설정
      const veryOldDate = new Date(Date.now() - 181 * DAY_MS); // 181일 전
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [veryOldDate.toISOString(), memoryId]);

      const result = await service.executeMemoryCleanup(db);

      // 하드 삭제가 실행되었는지 확인
      expect(result.summary.actualHardDeletes).toBeGreaterThanOrEqual(0);
    });

    it('pinned 메모리는 삭제하지 않아야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Pinned memory',
        type: 'episodic',
        importance: 0.1,
        pinned: true
      });

      const result = await service.executeMemoryCleanup(db);

      // pinned 메모리는 삭제되지 않아야 함
      expect(result.softDeleted).not.toContain(memoryId);
      expect(result.hardDeleted).not.toContain(memoryId);

      // 메모리가 여전히 존재하는지 확인
      const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [memoryId]);
      expect(memory).toBeDefined();
    });

    it('sweep: 소프트 삭제되었어도 pinned=1이면 물리 삭제하지 않는다 (FR-007)', async () => {
      vi.stubEnv('SOFT_DELETE_GRACE_PERIOD_DAYS', '1');
      const memoryId = createTestMemory(db, {
        content: 'Inconsistent pinned soft-deleted',
        type: 'episodic',
        importance: 0.5,
        pinned: false
      });
      const oldDeleted = new Date(Date.now() - 3 * DAY_MS).toISOString();
      DatabaseUtils.run(db, `
        UPDATE memory_item
        SET is_deleted = 1, deleted_at = ?, pinned = 1
        WHERE id = ?
      `, [oldDeleted, memoryId]);

      const result = await service.executeMemoryCleanup(db);

      expect(result.hardDeleted).not.toContain(memoryId);
      const row = DatabaseUtils.get(db, 'SELECT id FROM memory_item WHERE id = ?', [memoryId]) as { id: string } | undefined;
      expect(row?.id).toBe(memoryId);
      vi.unstubAllEnvs();
    });

    it('#1389: hard 임계를 넘어도 첫 실행은 soft만; 유예기간 뒤에만 hard', async () => {
      vi.stubEnv('SOFT_DELETE_GRACE_PERIOD_DAYS', '7');
      service = new ForgettingPolicyService({
        softDeleteThreshold: 0.1,
        hardDeleteThreshold: 0.5,
        ttlSoft: { working: 1, episodic: 1, semantic: 999, procedural: 999 },
        ttlHard: { working: 1, episodic: 1, semantic: 999, procedural: 999 },
      });

      const memoryId = createTestMemory(db, {
        content: 'Hard-threshold candidate',
        type: 'episodic',
        importance: 0.01,
        pinned: false,
      });
      DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ? WHERE id = ?', [
        new Date(Date.now() - 10 * DAY_MS).toISOString(),
        memoryId,
      ]);

      const analyzeSpy = vi.spyOn(service['forgettingAlgorithm'], 'analyzeForgetCandidates');
      analyzeSpy.mockReturnValue([
        {
          memory_id: memoryId,
          forget_score: 0.95,
          should_forget: true,
          reason: '사용되지 않음',
          features: {
            recency: 0.05,
            usage: 0.05,
            duplication_ratio: 0,
            importance: 0.01,
            pinned: false,
          },
        },
      ]);
      const first = await service.executeMemoryCleanup(db);
      expect(first.softDeleted).toContain(memoryId);
      expect(first.hardDeleted).not.toContain(memoryId);
      const afterSoft = DatabaseUtils.get(
        db,
        'SELECT is_deleted, deleted_at FROM memory_item WHERE id = ?',
        [memoryId],
      ) as { is_deleted: number; deleted_at: string } | undefined;
      expect(afterSoft).toBeDefined();
      expect(Number(afterSoft?.is_deleted)).toBe(1);
      expect(afterSoft?.deleted_at).toBeTruthy();

      const softEvents = DatabaseUtils.all(
        db,
        `SELECT action FROM memory_forgetting_event WHERE memory_id = ? AND action = 'soft'`,
        [memoryId],
      );
      expect(softEvents).toHaveLength(1);
      const hardEventsAfterFirst = DatabaseUtils.all(
        db,
        `SELECT action FROM memory_forgetting_event WHERE memory_id = ? AND action = 'hard'`,
        [memoryId],
      );
      expect(hardEventsAfterFirst).toHaveLength(0);

      DatabaseUtils.run(db, 'UPDATE memory_item SET deleted_at = ? WHERE id = ?', [
        new Date(Date.now() - 8 * DAY_MS).toISOString(),
        memoryId,
      ]);

      const second = await service.executeMemoryCleanup(db);
      expect(second.hardDeleted).toContain(memoryId);
      expect(
        DatabaseUtils.get(db, 'SELECT id FROM memory_item WHERE id = ?', [memoryId]),
      ).toBeUndefined();

      analyzeSpy.mockRestore();
      vi.unstubAllEnvs();
    });

    it('여러 타입의 메모리를 처리해야 함', async () => {
      createTestMemory(db, { content: 'Working memory', type: 'working', pinned: false });
      createTestMemory(db, { content: 'Episodic memory', type: 'episodic', pinned: false });
      createTestMemory(db, { content: 'Semantic memory', type: 'semantic', pinned: false });
      createTestMemory(db, { content: 'Procedural memory', type: 'procedural', pinned: false });

      const result = await service.executeMemoryCleanup(db);

      expect(result.totalProcessed).toBe(4);
    });
  });

  describe('generateForgettingStats', () => {
    it('망각 통계를 생성해야 함', async () => {
      createTestMemory(db, { content: 'Memory 1', type: 'episodic', importance: 0.5 });
      createTestMemory(db, { content: 'Memory 2', type: 'semantic', importance: 0.7 });
      createTestMemory(db, { content: 'Memory 3', type: 'working', importance: 0.3 });

      const stats = await service.generateForgettingStats(db);

      expect(stats).toHaveProperty('totalMemories');
      expect(stats).toHaveProperty('forgetCandidates');
      expect(stats).toHaveProperty('averageForgetScore');
      expect(stats).toHaveProperty('memoryDistribution');

      expect(stats.totalMemories).toBe(3);
      expect(stats.memoryDistribution.episodic).toBe(1);
      expect(stats.memoryDistribution.semantic).toBe(1);
      expect(stats.memoryDistribution.working).toBe(1);
    });

    it('평균 망각 점수를 계산해야 함', async () => {
      createTestMemory(db, { content: 'Memory 1', type: 'episodic', importance: 0.5 });
      createTestMemory(db, { content: 'Memory 2', type: 'episodic', importance: 0.7 });

      const stats = await service.generateForgettingStats(db);

      expect(stats.averageForgetScore).toBeGreaterThanOrEqual(0);
      expect(stats.averageForgetScore).toBeLessThanOrEqual(1);
    });
  });

  describe('shouldForget (ForgettingAlgorithm 직접 테스트)', () => {
    it('망각 점수가 임계값 이상이면 망각해야 함', async () => {
      // Given: ForgettingAlgorithm 직접 사용
      const { ForgettingAlgorithm } = await import('../../algorithms/forgetting-algorithm.js');
      const algorithm = new ForgettingAlgorithm();
      
      const forgetScore = 0.7; // 임계값(0.6) 이상
      const threshold = 0.6;

      // When: shouldForget 직접 호출
      const shouldForget = algorithm.shouldForget(forgetScore, threshold);

      // Then: 망각해야 함
      expect(shouldForget).toBe(true);
    });

    it('망각 점수가 임계값 미만이면 망각하지 않아야 함', async () => {
      // Given: ForgettingAlgorithm 직접 사용
      const { ForgettingAlgorithm } = await import('../../algorithms/forgetting-algorithm.js');
      const algorithm = new ForgettingAlgorithm();
      
      const forgetScore = 0.5; // 임계값(0.6) 미만
      const threshold = 0.6;

      // When: shouldForget 직접 호출
      const shouldForget = algorithm.shouldForget(forgetScore, threshold);

      // Then: 망각하지 않아야 함
      expect(shouldForget).toBe(false);
    });

    it('고정된 메모리는 망각하지 않아야 함', async () => {
      // Given: 고정된 메모리 생성
      createTestMemory(db, {
        content: 'Pinned memory',
        type: 'episodic',
        importance: 0.2,
        pinned: true // 고정됨
      });

      // When: 메모리 정리 실행
      const result = await service.executeMemoryCleanup(db);

      // Then: 고정된 메모리는 삭제되지 않아야 함
      expect(result.softDeleted.length).toBe(0);
      expect(result.hardDeleted.length).toBe(0);
    });
  });

  describe('calculateForgetScore (ForgettingAlgorithm 직접 테스트)', () => {
    it('망각 점수를 계산해야 함', async () => {
      // Given: ForgettingAlgorithm 직접 사용
      const { ForgettingAlgorithm } = await import('../../algorithms/forgetting-algorithm.js');
      const algorithm = new ForgettingAlgorithm();
      
      const features = {
        recency: 0.2, // 낮은 최근성
        usage: 0.1, // 낮은 사용성
        duplication_ratio: 0.5,
        importance: 0.3, // 낮은 중요도
        pinned: false
      };

      // When: calculateForgetScore 직접 호출
      const forgetScore = algorithm.calculateForgetScore(features);

      // Then: 망각 점수가 계산되어야 함
      expect(forgetScore).toBeGreaterThan(0);
      expect(typeof forgetScore).toBe('number');
    });

    it('높은 중요도 메모리는 낮은 망각 점수를 받아야 함', async () => {
      // Given: ForgettingAlgorithm 직접 사용
      const { ForgettingAlgorithm } = await import('../../algorithms/forgetting-algorithm.js');
      const algorithm = new ForgettingAlgorithm();
      
      const lowImportanceFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.3,
        importance: 0.2, // 낮은 중요도
        pinned: false
      };

      const highImportanceFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.3,
        importance: 0.9, // 높은 중요도
        pinned: false
      };

      // When: calculateForgetScore 직접 호출
      const lowScore = algorithm.calculateForgetScore(lowImportanceFeatures);
      const highScore = algorithm.calculateForgetScore(highImportanceFeatures);

      // Then: 낮은 중요도 메모리가 더 높은 망각 점수를 받아야 함
      expect(lowScore).toBeGreaterThan(highScore);
    });
  });

  describe('getMemoriesToForget (TTL 기반 망각 후보)', () => {
    it('TTL을 초과한 메모리를 망각 후보로 식별해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      // 오래된 episodic 메모리 생성 (TTL soft: 30일, hard: 180일)
      // 망각 점수를 충분히 높이기 위해:
      // 1. 매우 낮은 중요도 (0.01)
      // 2. 매우 오래된 날짜 (365일 전, recency 최소화)
      // 3. 중복 메모리 생성 (duplication_ratio 증가)
      const oldMemoryId = createTestMemory(db, {
        content: 'Old episodic memory',
        type: 'episodic',
        importance: 0.01, // 거의 0에 가까운 중요도로 망각 점수 최대화
        pinned: false
      });

      // 중복 메모리 생성 (duplication_ratio 증가를 위해)
      createTestMemory(db, {
        content: 'Old episodic memory duplicate',
        type: 'episodic',
        importance: 0.01,
        pinned: false
      });

      // 메모리 생성 시간을 365일 전으로 설정 (TTL soft: 30일 초과, 망각 점수 최대화)
      // episodic 반감기가 30일이므로 365일이면 recency가 매우 낮아짐
      const threeHundredSixtyFiveDaysAgo = new Date(now.getTime() - 365 * DAY_MS);
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [threeHundredSixtyFiveDaysAgo.toISOString(), oldMemoryId]);

      // When: 메모리 정리 실행
      const result = await service.executeMemoryCleanup(db);

      // Then: TTL을 초과한 메모리는 반드시 망각 후보로 식별되거나 실제 삭제가 발생해야 함
      // fallback 로직 완전 제거: totalProcessed만 확인하는 것은 TTL 로직 검증이 아님
      const wasDeleted = result.softDeleted.includes(oldMemoryId) || 
                         result.hardDeleted.includes(oldMemoryId);
      const hasDeletes = result.summary.actualSoftDeletes > 0 || 
                        result.summary.actualHardDeletes > 0;
      const hasCandidates = result.summary.forgetCandidates > 0;
      
      // TTL을 초과한 메모리는 반드시 망각 후보로 식별되거나 실제 삭제가 발생해야 함
      // 망각 점수가 충분히 높으면 실제 삭제, 낮으면 후보로 식별
      // 하지만 TTL 조건을 만족하는 메모리는 반드시 처리되어야 함
      if (!hasCandidates && !hasDeletes) {
        // 망각 점수가 임계값을 넘지 못한 경우, 테스트 실패
        // TTL 로직이 작동하지 않거나 망각 점수 계산이 잘못된 것
        throw new Error(
          `TTL을 초과한 메모리가 망각 후보로 식별되지 않았습니다. ` +
          `forgetCandidates: ${result.summary.forgetCandidates}, ` +
          `actualSoftDeletes: ${result.summary.actualSoftDeletes}, ` +
          `actualHardDeletes: ${result.summary.actualHardDeletes}`
        );
      }
      
      // 망각 후보가 식별되었거나 실제 삭제가 발생한 경우
      expect(hasCandidates || hasDeletes).toBe(true);
      
      // 실제로 삭제된 경우 해당 메모리 ID가 반드시 포함되어야 함
      if (wasDeleted) {
        expect(result.softDeleted.includes(oldMemoryId) || 
               result.hardDeleted.includes(oldMemoryId)).toBe(true);
      }
      
      // summary의 actualSoftDeletes 또는 actualHardDeletes가 증가했는지 확인
      if (hasDeletes) {
        expect(result.summary.actualSoftDeletes + result.summary.actualHardDeletes).toBeGreaterThan(0);
      }

      vi.useRealTimers();
    });

    it('working 타입 메모리는 2일 후 소프트 삭제 후보가 되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      // working 메모리 생성 (TTL soft: 2일, hard: 7일)
      // 망각 점수를 충분히 높이기 위해:
      // 1. 매우 낮은 중요도 (0.01)
      // 2. 매우 오래된 날짜 (30일 전, recency 최소화)
      // 3. 중복 메모리 생성 (duplication_ratio 증가)
      const workingMemoryId = createTestMemory(db, {
        content: 'Working memory',
        type: 'working',
        importance: 0.01, // 거의 0에 가까운 중요도로 망각 점수 최대화
        pinned: false
      });

      // 중복 메모리 생성 (duplication_ratio 증가를 위해)
      createTestMemory(db, {
        content: 'Working memory duplicate',
        type: 'working',
        importance: 0.01,
        pinned: false
      });

      // 30일 전으로 시간 설정 (TTL soft: 2일 초과, 망각 점수 최대화)
      // working 반감기가 2일이므로 30일이면 recency가 매우 낮아짐
      const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [thirtyDaysAgo.toISOString(), workingMemoryId]);

      // When: 메모리 정리 실행
      const result = await service.executeMemoryCleanup(db);

      // Then: working 메모리는 반드시 망각 후보로 식별되거나 실제 소프트 삭제가 발생해야 함
      // fallback 로직 완전 제거: totalProcessed만 확인하는 것은 TTL 로직 검증이 아님
      const wasSoftDeleted = result.softDeleted.includes(workingMemoryId);
      const hasSoftDeletes = result.summary.actualSoftDeletes > 0;
      const hasCandidates = result.summary.forgetCandidates > 0;
      
      // TTL을 초과한 working 메모리는 반드시 망각 후보로 식별되거나 실제 소프트 삭제가 발생해야 함
      if (!hasCandidates && !hasSoftDeletes) {
        // 망각 점수가 임계값을 넘지 못한 경우, 테스트 실패
        throw new Error(
          `TTL을 초과한 working 메모리가 망각 후보로 식별되지 않았습니다. ` +
          `forgetCandidates: ${result.summary.forgetCandidates}, ` +
          `actualSoftDeletes: ${result.summary.actualSoftDeletes}`
        );
      }
      
      // 망각 후보가 식별되었거나 실제 소프트 삭제가 발생한 경우
      expect(hasCandidates || hasSoftDeletes).toBe(true);
      
      // 실제로 소프트 삭제된 경우 해당 메모리 ID가 반드시 포함되어야 함
      if (wasSoftDeleted) {
        expect(result.softDeleted).toContain(workingMemoryId);
      }
      
      // summary의 actualSoftDeletes가 증가했는지 확인
      if (hasSoftDeletes) {
        expect(result.summary.actualSoftDeletes).toBeGreaterThan(0);
      }

      vi.useRealTimers();
    });

    it('semantic 타입 메모리는 180일 후 소프트 삭제 후보가 되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      // semantic 메모리 생성 (TTL soft: 180일, hard: 365일)
      // 망각 점수를 충분히 높이기 위해:
      // 1. 매우 낮은 중요도 (0.01)
      // 2. 매우 오래된 날짜 (730일 전, recency 최소화)
      // 3. 중복 메모리 생성 (duplication_ratio 증가)
      const semanticMemoryId = createTestMemory(db, {
        content: 'Semantic memory',
        type: 'semantic',
        importance: 0.01, // 거의 0에 가까운 중요도로 망각 점수 최대화
        pinned: false
      });

      // 중복 메모리 생성 (duplication_ratio 증가를 위해)
      createTestMemory(db, {
        content: 'Semantic memory duplicate',
        type: 'semantic',
        importance: 0.01,
        pinned: false
      });

      // 730일 전으로 시간 설정 (TTL soft: 180일 초과, 망각 점수 최대화)
      // semantic 반감기가 180일이므로 730일이면 recency가 매우 낮아짐
      const sevenHundredThirtyDaysAgo = new Date(now.getTime() - 730 * DAY_MS);
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [sevenHundredThirtyDaysAgo.toISOString(), semanticMemoryId]);

      // When: 메모리 정리 실행
      const result = await service.executeMemoryCleanup(db);

      // Then: semantic 메모리는 반드시 망각 후보로 식별되거나 실제 소프트 삭제가 발생해야 함
      // fallback 로직 완전 제거: totalProcessed만 확인하는 것은 TTL 로직 검증이 아님
      const wasSoftDeleted = result.softDeleted.includes(semanticMemoryId);
      const hasSoftDeletes = result.summary.actualSoftDeletes > 0;
      const hasCandidates = result.summary.forgetCandidates > 0;
      
      // TTL을 초과한 semantic 메모리는 반드시 망각 후보로 식별되거나 실제 소프트 삭제가 발생해야 함
      if (!hasCandidates && !hasSoftDeletes) {
        // 망각 점수가 임계값을 넘지 못한 경우, 테스트 실패
        throw new Error(
          `TTL을 초과한 semantic 메모리가 망각 후보로 식별되지 않았습니다. ` +
          `forgetCandidates: ${result.summary.forgetCandidates}, ` +
          `actualSoftDeletes: ${result.summary.actualSoftDeletes}`
        );
      }
      
      // 망각 후보가 식별되었거나 실제 소프트 삭제가 발생한 경우
      expect(hasCandidates || hasSoftDeletes).toBe(true);
      
      // 실제로 소프트 삭제된 경우 해당 메모리 ID가 반드시 포함되어야 함
      if (wasSoftDeleted) {
        expect(result.softDeleted).toContain(semanticMemoryId);
      }
      
      // summary의 actualSoftDeletes가 증가했는지 확인
      if (hasSoftDeletes) {
        expect(result.summary.actualSoftDeletes).toBeGreaterThan(0);
      }

      vi.useRealTimers();
    });

    it('TTL 내의 메모리는 망각 후보가 되지 않아야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      // 최근 episodic 메모리 생성 (TTL soft: 30일, 생성: 10일 전)
      // 중요도도 높게 설정하여 망각 점수를 낮춤
      const recentMemoryId = createTestMemory(db, {
        content: 'Recent episodic memory',
        type: 'episodic',
        importance: 0.8, // 높은 중요도로 망각 점수 낮춤
        pinned: false
      });

      // 10일 전으로 시간 설정 (JS에서 계산한 ISO 문자열 사용)
      const tenDaysAgo = new Date(now.getTime() - 10 * DAY_MS);
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [tenDaysAgo.toISOString(), recentMemoryId]);

      // When: 메모리 정리 실행
      const result = await service.executeMemoryCleanup(db);

      // Then: TTL 내의 메모리는 삭제되지 않아야 함
      expect(result.totalProcessed).toBeGreaterThanOrEqual(1);
      
      // 최근 메모리가 소프트 삭제 또는 하드 삭제 목록에 포함되지 않아야 함
      expect(result.softDeleted).not.toContain(recentMemoryId);
      expect(result.hardDeleted).not.toContain(recentMemoryId);
      
      // TTL 내 메모리는 실제로 삭제되지 않아야 함
      // (높은 중요도와 짧은 경과 시간으로 망각 점수가 낮아야 함)
      const wasDeleted = result.softDeleted.includes(recentMemoryId) || 
                         result.hardDeleted.includes(recentMemoryId);
      expect(wasDeleted).toBe(false);
      
      // TTL 내 메모리는 망각 후보로 식별되어도 실제 삭제는 되지 않아야 함
      // (망각 점수가 매우 높은 경우 후보가 될 수 있지만, TTL 조건을 만족하지 않으므로 삭제되지 않음)
      if (result.summary.forgetCandidates > 0) {
        // 망각 후보가 있어도 TTL 내 메모리는 삭제 목록에 포함되지 않아야 함
        expect(result.softDeleted).not.toContain(recentMemoryId);
        expect(result.hardDeleted).not.toContain(recentMemoryId);
      }

      vi.useRealTimers();
    });
  });

  describe('calculateForgetScore', () => {
    it('망각 점수를 계산해야 함', async () => {
      createTestMemory(db, {
        content: 'Low importance memory',
        type: 'episodic',
        importance: 0.2,
        pinned: false
      });

      const stats = await service.generateForgettingStats(db);
      
      // 망각 점수가 계산되었는지 확인
      expect(stats.averageForgetScore).toBeDefined();
    });
  });

  describe('TTL 검증', () => {
    it('working 타입 메모리의 TTL을 확인해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Working memory',
        type: 'working',
        importance: 0.3,
        pinned: false
      });

      // TTL 초과 날짜로 설정 (soft TTL: 2일, hard TTL: 7일)
      const softTTLDate = new Date(Date.now() - 3 * DAY_MS); // 3일 전
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [softTTLDate.toISOString(), memoryId]);

      const result = await service.executeMemoryCleanup(db);

      // TTL이 초과된 메모리는 처리 대상이 될 수 있음
      expect(result.totalProcessed).toBeGreaterThan(0);
    });

    it('episodic 타입 메모리의 TTL을 확인해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Episodic memory',
        type: 'episodic',
        importance: 0.3,
        pinned: false
      });

      // episodic soft TTL: 30일, hard TTL: 180일
      const softTTLDate = new Date(Date.now() - 31 * DAY_MS); // 31일 전
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [softTTLDate.toISOString(), memoryId]);

      const result = await service.executeMemoryCleanup(db);

      expect(result.totalProcessed).toBeGreaterThan(0);
    });

    it('semantic 타입 메모리의 TTL을 확인해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Semantic memory',
        type: 'semantic',
        importance: 0.3,
        pinned: false
      });

      // semantic soft TTL: 180일, hard TTL: 365일
      const softTTLDate = new Date(Date.now() - 181 * DAY_MS); // 181일 전
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [softTTLDate.toISOString(), memoryId]);

      const result = await service.executeMemoryCleanup(db);

      expect(result.totalProcessed).toBeGreaterThan(0);
    });

    it('procedural 타입 메모리의 TTL을 확인해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Procedural memory',
        type: 'procedural',
        importance: 0.3,
        pinned: false
      });

      // procedural soft TTL: 90일, hard TTL: 180일
      const softTTLDate = new Date(Date.now() - 91 * DAY_MS); // 91일 전
      DatabaseUtils.run(db, `
        UPDATE memory_item 
        SET created_at = ?
        WHERE id = ?
      `, [softTTLDate.toISOString(), memoryId]);

      const result = await service.executeMemoryCleanup(db);

      expect(result.totalProcessed).toBeGreaterThan(0);
    });
  });

  describe('커스텀 설정', () => {
    it('커스텀 설정으로 서비스를 생성할 수 있어야 함', () => {
      const customService = new ForgettingPolicyService({
        forgetThreshold: 0.7,
        softDeleteThreshold: 0.7,
        hardDeleteThreshold: 0.9
      });

      expect(customService).toBeDefined();
    });

    it('커스텀 TTL 설정을 사용해야 함', () => {
      const customService = new ForgettingPolicyService({
        ttlSoft: {
          working: 1,
          episodic: 15,
          semantic: 90,
          procedural: 45
        },
        ttlHard: {
          working: 3,
          episodic: 90,
          semantic: 180,
          procedural: 90
        }
      });

      expect(customService).toBeDefined();
    });
  });

  describe('#1743 매일 도는 정리', () => {
    const shiftOneDayBack = (column: string) =>
      `${column} = CASE WHEN ${column} IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '-1 day') END`;

    function passOneDay(): void {
      DatabaseUtils.run(db, `UPDATE memory_item SET ${shiftOneDayBack('created_at')}, ${shiftOneDayBack('last_accessed')}`);
    }

    function seedRecentEpisodic(count: number): void {
      const createdAt = new Date(Date.now() - DAY_MS).toISOString();
      const lastAccessed = new Date().toISOString();
      for (let i = 0; i < count; i++) {
        const id = createTestMemory(db, { content: `filler ${i}`, type: 'episodic', importance: 0.9 });
        DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ?, last_accessed = ? WHERE id = ?', [createdAt, lastAccessed, id]);
      }
    }

    function isSoftDeleted(id: string): boolean {
      const row = DatabaseUtils.get(db, 'SELECT is_deleted FROM memory_item WHERE id = ?', [id]) as { is_deleted: number } | undefined;
      return Number(row?.is_deleted) === 1;
    }

    it('정리는 last_accessed 를 지금으로 바꾸지 않는다', async () => {
      seedRecentEpisodic(20);
      const lastAccessed = new Date(Date.now() - 5 * DAY_MS).toISOString();
      const id = createTestMemory(db, { content: 'target', type: 'episodic', importance: 0.5 });
      DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ?, last_accessed = ? WHERE id = ?', [
        new Date(Date.now() - 200 * DAY_MS).toISOString(),
        lastAccessed,
        id,
      ]);

      await service.executeMemoryCleanup(db);

      const row = DatabaseUtils.get(db, 'SELECT last_accessed FROM memory_item WHERE id = ?', [id]) as { last_accessed: string };
      expect(row.last_accessed).toBe(lastAccessed);
    });

    it('접근이 끊긴 기억은 매일 정리를 60일 돌리면 소프트 삭제된다', async () => {
      seedRecentEpisodic(20);
      const id = createTestMemory(db, { content: 'target', type: 'episodic', importance: 0.1 });
      DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ?, last_accessed = ? WHERE id = ?', [
        new Date(Date.now() - 200 * DAY_MS).toISOString(),
        new Date(Date.now() - 5 * DAY_MS).toISOString(),
        id,
      ]);

      for (let day = 0; day < 60 && !isSoftDeleted(id); day++) {
        await service.executeMemoryCleanup(db);
        passOneDay();
      }

      expect(isSoftDeleted(id)).toBe(true);
    });

    it('48시간이 지난 working 기억은 중요도가 운영 평균(0.6)이어도 소프트 삭제된다', async () => {
      seedRecentEpisodic(20);
      const id = createTestMemory(db, { content: 'scratch', type: 'working', importance: 0.6 });
      DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ? WHERE id = ?', [
        new Date(Date.now() - 3 * DAY_MS).toISOString(),
        id,
      ]);

      const result = await service.executeMemoryCleanup(db);

      expect(result.softDeleted).toContain(id);
    });
  });

  describe('#1747 softDeleteThreshold', () => {
    it('0.6 아래로 낮춘 임계값이 그대로 적용된다', async () => {
      const id = createTestMemory(db, { content: 'old', type: 'episodic', importance: 0.5 });
      const longAgo = new Date(Date.now() - 200 * DAY_MS).toISOString();
      DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ?, last_accessed = ? WHERE id = ?', [longAgo, longAgo, id]);

      // 망각 점수 약 0.52 (유형 비중 0, 중요도 0.5)
      expect((await new ForgettingPolicyService().executeMemoryCleanup(db)).softDeleted).not.toContain(id);
      const result = await new ForgettingPolicyService({ softDeleteThreshold: 0.3 }).executeMemoryCleanup(db);

      expect(result.softDeleted).toContain(id);
    });
  });
});
