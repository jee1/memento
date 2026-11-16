/**
 * 망각 정책 서비스
 * 망각 점수와 유형별 TTL 로 기억을 소프트 삭제하고, 유예가 지난 행을 영구 삭제한다
 */

import type Database from 'better-sqlite3';
import { daysBetween } from '../../../shared/utils/date.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { tagMatchSql } from '../../../shared/utils/memory-filter-sql.js';
import {
  DEFAULT_FORGETTING_POLICY_NAME,
  ForgettingEventRepository,
} from '../repositories/forgetting-event-repository.js';
import { ForgettingAlgorithm, type ForgettingResult } from '../algorithms/forgetting-algorithm.js';

interface ForgettingPolicyConfig {
  softDeleteThreshold: number;    // 소프트 삭제 임계값 (기본: 0.6)

  // TTL 설정 (일 단위)
  ttlSoft: {
    working: number;
    episodic: number;
    semantic: number;
    procedural: number;
  };
}

/** 마이그레이션 067 의 name. 적용 시각이 주입 쓰임 기록의 시작이다 (#1751) */
const RECALL_USE_RECORDING_START_MIGRATION = 'recall-use-recording-start';

/** 주인 지침. 망각 정리 대상에서 뺀다 (#1749) */
const USER_DIRECTIVE_TAG = 'user-directive';

/** 망각 분석용 메모리 행 (getAllMemories) */
interface PolicyMemoryRow {
  id: string;
  created_at: string;
  /** max(last_recalled_at, created_at, 통계 수집 시작 시각) */
  last_used_at: string;
  recall_count: number;
  importance: number;
  pinned: boolean;
  type: string;
}

const WORKING_TTL_REASON = 'working TTL 만료';

function latestIso(...values: Array<string | null>): string {
  return values
    .filter((v): v is string => Boolean(v))
    .reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
}

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
      softDeleteThreshold: 0.6,
      ttlSoft: {
        working: 2,
        episodic: 30,
        semantic: 180,
        procedural: 90
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
        const deleted = await this.softDeleteMemory(db, candidate.memory_id, {
          forgetScore: candidate.forget_score,
          reason: memory.type === 'working' ? WORKING_TTL_REASON : candidate.reason,
          ttlDays,
        });
        if (!deleted) continue;
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
    const statsStartedAt = this.getRecallStatsStartedAt(db);
    const rows = (await DatabaseUtils.all(db, `
      SELECT
        m.id, m.created_at, m.importance, m.pinned, m.type,
        COALESCE(s.recall_count, 0) AS recall_count,
        s.last_recalled_at
      FROM memory_item m
      LEFT JOIN meta_memory_stats s ON s.memory_id = m.id
      WHERE m.pinned = FALSE
        AND (m.is_deleted IS NULL OR m.is_deleted = 0)
        AND NOT ${tagMatchSql('m.tags')}
      ORDER BY m.created_at DESC
    `, [USER_DIRECTIVE_TAG])) as Array<Omit<PolicyMemoryRow, 'last_used_at'> & { last_recalled_at: string | null }>;

    return rows.map(({ last_recalled_at, ...row }) => ({
      ...row,
      last_used_at: latestIso(row.created_at, last_recalled_at, statsStartedAt),
    }));
  }

  /**
   * 쓰임 기록을 모으기 시작한 시각 (#1751). 그 전 기간은 「안 쓰임」으로 세지 않는다.
   * 통계의 가장 이른 행과, 주입 쓰임 기록을 켠 마이그레이션 067 이 적용된 시각 중 늦은 쪽이다.
   * 둘 다 없으면 지금으로 본다. 두 값 모두 CURRENT_TIMESTAMP(UTC) 형식이라 ISO 로 바꿔 읽는다.
   */
  private getRecallStatsStartedAt(db: Database.Database): string {
    const statsStart = DatabaseUtils.get(
      db,
      `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', MIN(created_at)) AS at FROM meta_memory_stats`,
    ) as { at: string | null } | undefined;
    const hasVersionTable = DatabaseUtils.get(
      db,
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'memento_schema_version'`,
    );
    const markerApplied = hasVersionTable
      ? (DatabaseUtils.get(
          db,
          `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', applied_at) AS at FROM memento_schema_version WHERE migration_name = ?`,
          [RECALL_USE_RECORDING_START_MIGRATION],
        ) as { at: string | null } | undefined)
      : undefined;
    const known = [statsStart?.at ?? null, markerApplied?.at ?? null].filter((v): v is string => Boolean(v));
    return known.length > 0 ? latestIso(...known) : new Date().toISOString();
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
   * 망각 점수 상한(0.35 + 0.25 + 0.20 x 유형 비중 - 0.15 x 중요도)이 working 에서는 중요도가 거의 0 이 아니면 0.6 에 닿지 않는다.
   */
  private isSoftDeleteCandidate(memory: PolicyMemoryRow, candidate: ForgettingResult): boolean {
    const ttl = this.config.ttlSoft[memory.type as keyof typeof this.config.ttlSoft];
    if (memory.pinned || ttl === undefined) return false;
    if (memory.type === 'working') return daysBetween(new Date(), new Date(memory.created_at)) >= ttl;
    // #1751: 나머지 유형은 ttlSoft 동안 쓰이지 않아야 후보가 된다
    if (daysBetween(new Date(), new Date(memory.last_used_at)) < ttl) return false;
    return candidate.forget_score >= this.config.softDeleteThreshold;
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
        AND NOT ${tagMatchSql()}
    `, [days, USER_DIRECTIVE_TAG])) as Array<{ id: string }>;
    const deleted: string[] = [];
    for (const r of rows) {
      const removed = await this.hardDeleteMemory(db, r.id, {
        forgetScore: null,
        reason: 'soft_delete_grace_period_expired',
        ttlDays: days,
      });
      if (removed) deleted.push(r.id);
    }
    return deleted;
  }

  private async softDeleteMemory(
    db: Database.Database,
    memoryId: string,
    event: { forgetScore: number; reason: string; ttlDays: number },
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const { changes } = DatabaseUtils.run(
      db,
      `
      UPDATE memory_item
      SET is_deleted = 1,
          deleted_at = ?,
          pinned = 0
      WHERE id = ?
        AND COALESCE(pinned, 0) = 0
        AND COALESCE(is_deleted, 0) = 0
    `,
      [now, memoryId]
    );
    if (changes === 0) return false;
    this.forgettingEventRepository.insert(db, {
      memory_id: memoryId,
      action: 'soft',
      reason: event.reason,
      policy: DEFAULT_FORGETTING_POLICY_NAME,
      forget_score: event.forgetScore,
      ttl_days: event.ttlDays,
      metadata_json: JSON.stringify({ deleted_at: now }),
    });
    return true;
  }

  /**
   * 하드 삭제 실행
   */
  private async hardDeleteMemory(
    db: Database.Database,
    memoryId: string,
    event: { forgetScore: number | null; reason: string; ttlDays: number },
  ): Promise<boolean> {
    const { changes } = DatabaseUtils.run(
      db,
      'DELETE FROM memory_item WHERE id = ? AND COALESCE(pinned, 0) = 0',
      [memoryId]
    );
    if (changes === 0) return false;
    this.forgettingEventRepository.insert(db, {
      memory_id: memoryId,
      action: 'hard',
      reason: event.reason,
      policy: DEFAULT_FORGETTING_POLICY_NAME,
      forget_score: event.forgetScore,
      ttl_days: event.ttlDays,
    });
    return true;
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
    const averageForgetScore = forgetResults.length
      ? forgetResults.reduce((sum, r) => sum + r.forget_score, 0) / forgetResults.length
      : 0;
    
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
