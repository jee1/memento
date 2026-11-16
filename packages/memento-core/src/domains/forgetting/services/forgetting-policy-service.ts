/**
 * 망각 정책 서비스
 * 망각 점수와 유형별 TTL 로 기억을 소프트 삭제하고, 유예가 지난 행을 영구 삭제한다
 */

import type Database from 'better-sqlite3';
import { daysBetween } from '../../../shared/utils/date.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import {
  DEFAULT_FORGETTING_POLICY_NAME,
  ForgettingEventRepository,
} from '../repositories/forgetting-event-repository.js';
import { ForgettingAlgorithm, type ForgettingResult } from '../algorithms/forgetting-algorithm.js';

interface ForgettingPolicyConfig {
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

const WORKING_TTL_REASON = 'working TTL 만료';

export interface MemoryCleanupResult {
  softDeleted: string[];
  hardDeleted: string[];
  totalProcessed: number;
  summary: {
    forgetCandidates: number;
    actualSoftDeletes: number;
    actualHardDeletes: number;
  };
}

export class ForgettingPolicyService {
  private forgettingAlgorithm: ForgettingAlgorithm;
  private config: ForgettingPolicyConfig;
  private forgettingEventRepository: ForgettingEventRepository;

  constructor(config?: Partial<ForgettingPolicyConfig>) {
    this.forgettingAlgorithm = new ForgettingAlgorithm();
    this.forgettingEventRepository = new ForgettingEventRepository();
    
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
      ...config
    };
  }

  /**
   * 메모리 정리 실행
   */
  async executeMemoryCleanup(db: Database.Database): Promise<MemoryCleanupResult> {
    const result: MemoryCleanupResult = {
      softDeleted: [],
      hardDeleted: [],
      totalProcessed: 0,
      summary: {
        forgetCandidates: 0,
        actualSoftDeletes: 0,
        actualHardDeletes: 0
      }
    };

    try {
      // 1. 모든 메모리 가져오기
      const memories = await this.getAllMemories(db);
      result.totalProcessed = memories.length;

      // 2. 망각 후보 분석
      const forgetResults = this.forgettingAlgorithm.analyzeForgetCandidates(memories);
      const candidates = this.selectSoftDeleteCandidates(memories, forgetResults);
      result.summary.forgetCandidates = candidates.length;

      // 3. 소프트 삭제 실행
      for (const { candidate, memory } of candidates) {
        const ttlDays = this.config.ttlSoft[memory.type as keyof typeof this.config.ttlSoft];
        await this.softDeleteMemory(db, candidate.memory_id, {
          forgetScore: candidate.forget_score,
          reason: memory.type === 'working' ? WORKING_TTL_REASON : candidate.reason,
          ttlDays,
        });
        result.softDeleted.push(candidate.memory_id);
        result.summary.actualSoftDeletes++;
      }

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

    return (rows as PolicyMemoryRow[]).map((row) => ({
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

  private selectSoftDeleteCandidates(
    memories: PolicyMemoryRow[],
    forgetResults: ForgettingResult[],
  ): Array<{ candidate: ForgettingResult; memory: PolicyMemoryRow }> {
    const memoryById = new Map(memories.map(m => [m.id, m]));
    return forgetResults.flatMap((candidate) => {
      const memory = memoryById.get(candidate.memory_id);
      return memory && this.isSoftDeleteCandidate(memory, candidate) ? [{ candidate, memory }] : [];
    });
  }

  /**
   * 소프트 삭제 후보 확인
   *
   * working 은 ttlSoft 가 지나면 점수와 관계없이 지운다 (#1743).
   * 망각 점수 상한(0.35 + 0.25 + 0.20·유형 비중 − 0.15·중요도)이 working 에서는 0.6 에 닿지 않는다.
   */
  private isSoftDeleteCandidate(memory: PolicyMemoryRow, candidate: ForgettingResult): boolean {
    const ageDays = daysBetween(new Date(), new Date(memory.created_at));
    const ttl = this.config.ttlSoft[memory.type as keyof typeof this.config.ttlSoft];
    if (memory.pinned || ageDays < ttl) return false;
    if (memory.type === 'working') return true;
    return candidate.should_forget && candidate.forget_score >= this.config.softDeleteThreshold;
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
      await this.hardDeleteMemory(db, r.id, {
        forgetScore: null,
        reason: 'soft_delete_grace_period_expired',
        ttlDays: days,
      });
      deleted.push(r.id);
    }
    return deleted;
  }

  private async softDeleteMemory(
    db: Database.Database,
    memoryId: string,
    event: { forgetScore: number; reason: string; ttlDays: number },
  ): Promise<void> {
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
    this.forgettingEventRepository.insert(db, {
      memory_id: memoryId,
      action: 'soft',
      reason: event.reason,
      policy: DEFAULT_FORGETTING_POLICY_NAME,
      forget_score: event.forgetScore,
      ttl_days: event.ttlDays,
      metadata_json: JSON.stringify({ deleted_at: now }),
    });
  }

  /**
   * 하드 삭제 실행
   */
  private async hardDeleteMemory(
    db: Database.Database,
    memoryId: string,
    event: { forgetScore: number | null; reason: string; ttlDays: number },
  ): Promise<void> {
    await DatabaseUtils.run(
      db,
      'DELETE FROM memory_item WHERE id = ? AND COALESCE(pinned, 0) = 0',
      [memoryId]
    );
    this.forgettingEventRepository.insert(db, {
      memory_id: memoryId,
      action: 'hard',
      reason: event.reason,
      policy: DEFAULT_FORGETTING_POLICY_NAME,
      forget_score: event.forgetScore,
      ttl_days: event.ttlDays,
    });
  }

  /**
   * 망각 통계 생성
   */
  async generateForgettingStats(db: Database.Database): Promise<{
    totalMemories: number;
    forgetCandidates: number;
    averageForgetScore: number;
    memoryDistribution: Record<string, number>;
  }> {
    const memories = await this.getAllMemories(db);
    const forgetResults = this.forgettingAlgorithm.analyzeForgetCandidates(memories);
    
    const forgetCandidates = this.selectSoftDeleteCandidates(memories, forgetResults).length;
    const averageForgetScore = forgetResults.reduce((sum, r) => sum + r.forget_score, 0) / forgetResults.length;
    
    const memoryDistribution = memories.reduce((acc, memory) => {
      acc[memory.type] = (acc[memory.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalMemories: memories.length,
      forgetCandidates,
      averageForgetScore,
      memoryDistribution
    };
  }
}
