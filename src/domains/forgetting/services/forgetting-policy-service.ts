/**
 * 망각 정책 서비스
 * 망각 알고리즘과 간격 반복을 통합하여 메모리 관리
 */

import type Database from 'better-sqlite3';
import { ForgettingAlgorithm, type ForgettingResult } from '../algorithms/forgetting-algorithm.js';
import { SpacedRepetitionAlgorithm, type ReviewSchedule } from '../algorithms/spaced-repetition.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';

export interface ForgettingPolicyConfig {
  // 망각 정책 설정
  forgetThreshold: number;        // 망각 임계값 (기본: 0.6)
  softDeleteThreshold: number;    // 소프트 삭제 임계값 (기본: 0.6)
  hardDeleteThreshold: number;    // 하드 삭제 임계값 (기본: 0.8)
  
  // TTL 설정 (일 단위)
  ttlSoft: {
    working: number;
    episodic: number;
    semantic: number;
    procedural: number;
  };
  
  ttlHard: {
    working: number;
    episodic: number;
    semantic: number;
    procedural: number;
  };
  
  // 간격 반복 설정
  reviewThreshold: number;        // 리뷰 임계값 (기본: 0.7)
  maxInterval: number;           // 최대 간격 (일, 기본: 365)
  minInterval: number;           // 최소 간격 (일, 기본: 1)
}

/** 망각 분석용 메모리 행 (getAllMemories) */
interface PolicyMemoryRow {
  id: string;
  created_at: string;
  last_accessed?: string;
  importance: number;
  pinned: boolean;
  type: string;
  view_count?: number;
  cite_count?: number;
  edit_count?: number;
}

export interface MemoryCleanupResult {
  softDeleted: string[];
  hardDeleted: string[];
  reviewed: string[];
  totalProcessed: number;
  summary: {
    forgetCandidates: number;
    reviewCandidates: number;
    actualSoftDeletes: number;
    actualHardDeletes: number;
    actualReviews: number;
  };
}

export class ForgettingPolicyService {
  private forgettingAlgorithm: ForgettingAlgorithm;
  private spacedRepetition: SpacedRepetitionAlgorithm;
  private config: ForgettingPolicyConfig;

  constructor(config?: Partial<ForgettingPolicyConfig>) {
    this.forgettingAlgorithm = new ForgettingAlgorithm();
    this.spacedRepetition = new SpacedRepetitionAlgorithm();
    
    this.config = {
      forgetThreshold: 0.6,
      softDeleteThreshold: 0.6,
      hardDeleteThreshold: 0.8,
      ttlSoft: {
        working: 2,
        episodic: 30,
        semantic: 180,
        procedural: 90
      },
      ttlHard: {
        working: 7,
        episodic: 180,
        semantic: 365,
        procedural: 180
      },
      reviewThreshold: 0.7,
      maxInterval: 365,
      minInterval: 1,
      ...config
    };
  }

  /**
   * 메모리 정리 실행 (망각 + 간격 반복)
   */
  async executeMemoryCleanup(db: Database.Database): Promise<MemoryCleanupResult> {
    const result: MemoryCleanupResult = {
      softDeleted: [],
      hardDeleted: [],
      reviewed: [],
      totalProcessed: 0,
      summary: {
        forgetCandidates: 0,
        reviewCandidates: 0,
        actualSoftDeletes: 0,
        actualHardDeletes: 0,
        actualReviews: 0
      }
    };

    try {
      // 1. 모든 메모리 가져오기
      const memories = await this.getAllMemories(db);
      result.totalProcessed = memories.length;

      // 2. 망각 후보 분석
      const forgetResults = this.forgettingAlgorithm.analyzeForgetCandidates(memories);
      result.summary.forgetCandidates = forgetResults.filter(r => r.should_forget).length;

      // 3. 간격 반복 후보 분석
      const reviewSchedules = await this.analyzeReviewCandidates(db, memories);
      result.summary.reviewCandidates = reviewSchedules.filter(s => s.needs_review).length;

      const memoryById = new Map(memories.map(m => [m.id, m]));

      // 4. 소프트 삭제 실행
      const softDeleteCandidates = forgetResults.filter(r =>
        r.should_forget &&
        r.forget_score >= this.config.softDeleteThreshold &&
        !r.features.pinned
      );

      for (const candidate of softDeleteCandidates) {
        const memory = memoryById.get(candidate.memory_id);
        if (memory && this.isSoftDeleteCandidate(memory, candidate.forget_score)) {
          await this.softDeleteMemory(db, candidate.memory_id);
          result.softDeleted.push(candidate.memory_id);
          result.summary.actualSoftDeletes++;
        }
      }

      // 5. 하드 삭제 실행
      const hardDeleteCandidates = forgetResults.filter(r =>
        r.should_forget &&
        r.forget_score >= this.config.hardDeleteThreshold &&
        !r.features.pinned
      );

      for (const candidate of hardDeleteCandidates) {
        const memory = memoryById.get(candidate.memory_id);
        if (memory && this.isHardDeleteCandidate(memory, candidate.forget_score)) {
          await this.hardDeleteMemory(db, candidate.memory_id);
          result.hardDeleted.push(candidate.memory_id);
          result.summary.actualHardDeletes++;
        }
      }

      // 6. 리뷰 스케줄 업데이트 (병렬 실행으로 N+1 완화)
      const reviewCandidates = reviewSchedules.filter(s => s.needs_review);
      await Promise.all(reviewCandidates.map(async (schedule) => {
        await this.updateReviewSchedule(db, schedule);
        result.reviewed.push(schedule.memory_id);
        result.summary.actualReviews++;
      }));

      const swept = await this.sweepExpiredSoftDeletes(db);
      result.hardDeleted.push(...swept);
      result.summary.actualHardDeletes += swept.length;

      return result;

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('메모리 정리 실행 실패', {
        error: maskedError.message
      });
      throw error;
    }
  }

  /**
   * 모든 메모리 가져오기
   */
  private async getAllMemories(db: Database.Database): Promise<PolicyMemoryRow[]> {
    const rows = await DatabaseUtils.all(db, `
      SELECT 
        id, created_at, last_accessed, importance, pinned, type,
        COALESCE(view_count, 0) as view_count,
        COALESCE(cite_count, 0) as cite_count,
        COALESCE(edit_count, 0) as edit_count
      FROM memory_item
      WHERE pinned = FALSE
        AND (is_deleted IS NULL OR is_deleted = 0)
      ORDER BY created_at DESC
    `);

    return rows.map((row: PolicyMemoryRow) => ({
      id: row.id,
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      importance: row.importance,
      pinned: row.pinned,
      type: row.type,
      view_count: row.view_count,
      cite_count: row.cite_count,
      edit_count: row.edit_count
    }));
  }

  /**
   * 리뷰 후보 분석
   *
   * @remarks 피드백 가중치는 feedback_event 연동 전까지 보수적 기본값을 사용한다(스케줄 생성만 수행).
   */
  private async analyzeReviewCandidates(db: Database.Database, memories: PolicyMemoryRow[]): Promise<ReviewSchedule[]> {
    const schedules: ReviewSchedule[] = [];

    for (const memory of memories) {
      const features = {
        importance: memory.importance,
        usage: this.calculateUsageScore(memory),
        helpful_feedback: 0.5, // 기본값
        bad_feedback: 0.1      // 기본값
      };

      const currentInterval = 7; // 기본 간격
      const lastReview = memory.last_accessed ? new Date(memory.last_accessed) : new Date(memory.created_at);

      const schedule = this.spacedRepetition.createReviewSchedule(
        memory.id,
        currentInterval,
        lastReview,
        features
      );

      schedules.push(schedule);
    }

    return schedules;
  }

  /**
   * 사용성 점수 계산
   */
  private calculateUsageScore(memory: PolicyMemoryRow): number {
    const viewScore = Math.log(1 + (memory.view_count || 0));
    const citeScore = 2 * Math.log(1 + (memory.cite_count || 0));
    const editScore = 0.5 * Math.log(1 + (memory.edit_count || 0));
    
    return Math.min(1, (viewScore + citeScore + editScore) / 10);
  }

  /**
   * 소프트 삭제 후보 확인
   */
  private isSoftDeleteCandidate(memory: PolicyMemoryRow, forgetScore: number): boolean {
    const ageDays = this.getAgeInDays(new Date(memory.created_at));
    const ttl = this.config.ttlSoft[memory.type as keyof typeof this.config.ttlSoft];
    
    return forgetScore >= this.config.softDeleteThreshold && 
           ageDays >= ttl && 
           !memory.pinned;
  }

  /**
   * 하드 삭제 후보 확인
   */
  private isHardDeleteCandidate(memory: PolicyMemoryRow, forgetScore: number): boolean {
    const ageDays = this.getAgeInDays(new Date(memory.created_at));
    const ttl = this.config.ttlHard[memory.type as keyof typeof this.config.ttlHard];
    
    return forgetScore >= this.config.hardDeleteThreshold && 
           ageDays >= ttl && 
           !memory.pinned;
  }

  /**
   * 소프트 삭제 실행
   */
  private getSoftDeleteGracePeriodDays(): number {
    const raw = process.env.SOFT_DELETE_GRACE_PERIOD_DAYS;
    const n = raw ? parseInt(raw, 10) : 30;
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  /**
   * 유예 기간이 지난 소프트 삭제 행을 물리 삭제
   */
  private async sweepExpiredSoftDeletes(db: Database.Database): Promise<string[]> {
    const days = this.getSoftDeleteGracePeriodDays();
    const rows = (await DatabaseUtils.all(db, `
      SELECT id FROM memory_item
      WHERE COALESCE(is_deleted, 0) = 1
        AND COALESCE(pinned, 0) = 0
        AND deleted_at IS NOT NULL
        AND datetime(deleted_at) < datetime('now', '-' || ? || ' days')
    `, [days])) as Array<{ id: string }>;
    const deleted: string[] = [];
    for (const r of rows) {
      await DatabaseUtils.run(
        db,
        'DELETE FROM memory_item WHERE id = ? AND COALESCE(pinned, 0) = 0',
        [r.id]
      );
      deleted.push(r.id);
    }
    return deleted;
  }

  private async softDeleteMemory(db: Database.Database, memoryId: string): Promise<void> {
    const now = new Date().toISOString();
    await DatabaseUtils.run(
      db,
      `
      UPDATE memory_item
      SET is_deleted = 1,
          deleted_at = ?,
          pinned = 0,
          last_accessed = CURRENT_TIMESTAMP
      WHERE id = ?
        AND COALESCE(pinned, 0) = 0
    `,
      [now, memoryId]
    );
  }

  /**
   * 하드 삭제 실행
   */
  private async hardDeleteMemory(db: Database.Database, memoryId: string): Promise<void> {
    await DatabaseUtils.run(
      db,
      'DELETE FROM memory_item WHERE id = ? AND COALESCE(pinned, 0) = 0',
      [memoryId]
    );
  }

  /**
   * 리뷰 스케줄 업데이트
   */
  private async updateReviewSchedule(db: Database.Database, schedule: ReviewSchedule): Promise<void> {
    // 실제로는 별도의 리뷰 스케줄 테이블에 저장
    await DatabaseUtils.run(db, `
      UPDATE memory_item 
      SET last_accessed = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [schedule.memory_id]);
  }

  /**
   * 나이 계산 (일 단위)
   */
  private getAgeInDays(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }

  /**
   * 망각 통계 생성
   */
  async generateForgettingStats(db: Database.Database): Promise<{
    totalMemories: number;
    forgetCandidates: number;
    reviewCandidates: number;
    averageForgetScore: number;
    memoryDistribution: Record<string, number>;
  }> {
    const memories = await this.getAllMemories(db);
    const forgetResults = this.forgettingAlgorithm.analyzeForgetCandidates(memories);
    
    const forgetCandidates = forgetResults.filter(r => r.should_forget).length;
    const averageForgetScore = forgetResults.reduce((sum, r) => sum + r.forget_score, 0) / forgetResults.length;
    
    const memoryDistribution = memories.reduce((acc, memory) => {
      acc[memory.type] = (acc[memory.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalMemories: memories.length,
      forgetCandidates,
      reviewCandidates: 0, // 실제로는 리뷰 후보 계산
      averageForgetScore,
      memoryDistribution
    };
  }
}
