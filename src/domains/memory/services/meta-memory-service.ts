/**
 * Meta Memory Service
 * 
 * 메타 메모리 통계 수집 및 관리 서비스
 * recall 성공/실패, confidence 점수 등의 통계를 수집합니다.
 */

import Database from 'better-sqlite3';
import { WriteCoalescingManager, type CoalescedWrite } from '../../../shared/utils/write-coalescing.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import type { RecallResultItem } from '../tools/recall-tool.js';
import type { MetaMemoryStats, GetMetaMemoryStatsParams, MetaMemoryStatsResult } from '../../../shared/types/index.js';

/**
 * Meta Memory Statistics 업데이트를 위한 CoalescedWrite 확장
 */
interface MetaMemoryStatsWrite {
  memoryId: string;
  recallCount: number;
  successCount: number;
  failureCount: number;
  avgConfidence: number;
  lastRecalledAt: string; // ISO timestamp
}

/** meta_memory_stats 테이블 SELECT row 형태 */
interface MetaMemoryStatsRow {
  memory_id: string;
  recall_count: number;
  success_count: number;
  failure_count: number;
  avg_confidence: number;
  last_recalled_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Meta Memory Service
 * 
 * recall 통계를 수집하고 관리하는 서비스입니다.
 */
export class MetaMemoryService {
  private writeCoalescingManager: WriteCoalescingManager;
  private readonly flushInterval = 100; // 100ms debounce

  constructor(
    private db: Database.Database,
    writeCoalescingManager?: WriteCoalescingManager
  ) {
    if (!db) {
      throw new Error('Database instance is required');
    }

    // WriteCoalescingManager 초기화 (meta_memory_stats 업데이트용)
    if (writeCoalescingManager) {
      this.writeCoalescingManager = writeCoalescingManager;
    } else {
      // 자체 WriteCoalescingManager 생성 (100ms debounce)
      this.writeCoalescingManager = new WriteCoalescingManager(
        this.flushInterval,
        async (writes: CoalescedWrite[]) => {
          // meta_memory_stats 업데이트를 위한 flushCallback (본 서비스는 MetaMemoryStatsWrite만 추가)
          await this.flushToDatabase(writes as unknown as MetaMemoryStatsWrite[]);
        }
      );
    }
  }

  /**
   * Recall 통계 기록
   * 
   * 검색 결과를 기반으로 각 메모리 항목의 통계를 업데이트합니다.
   * 
   * @param items 검색 결과 항목 배열
   */
  async recordRecall(items: RecallResultItem[]): Promise<void> {
    // 검색 결과가 0개면 통계 업데이트 없음
    if (items.length === 0) {
      return;
    }

    // 같은 호출 내에서 같은 memory_id가 여러 번 나타나는 경우를 처리하기 위해
    // 현재 호출의 항목들을 먼저 수집하여 처리
    // 이렇게 하면 같은 호출 내에서는 버퍼의 값을 확인할 수 있고,
    // 다른 호출 사이에서는 debounce가 작동하여 마지막 호출만 반영됨
    const currentCallBuffer: Map<string, MetaMemoryStatsWrite> = new Map();

    // 각 항목별로 통계 업데이트
    for (const item of items) {
      try {
        const memoryId = item.memory_id || item.id;
        if (!memoryId) {
          logger.warn('MetaMemoryService: memoryId가 없어 통계 업데이트를 건너뜁니다', {
            item_id: item.id,
            has_memory_id: !!item.memory_id
          });
          continue;
        }

        // 성공/실패 판정
        const isSuccess = this.isItemSuccess(item);

        // Confidence 점수 계산
        const confidence = this.calculateConfidence(item);

        // 현재 통계 조회
        // 같은 호출 내에서 같은 memory_id가 여러 번 나타나는 경우를 처리하기 위해
        // 먼저 현재 호출의 버퍼를 확인하고, 없으면 DB에서 가져옴
        // 다른 호출 사이에서는 debounce가 작동하여 마지막 호출만 반영됨
        let baseStats = await this.getStatsById(memoryId);
        
        // 같은 호출 내에서 같은 memory_id가 여러 번 나타나는 경우를 처리
        // 현재 호출의 버퍼에 같은 memoryId가 이미 있으면 그 값을 기반으로 계산
        const currentCallBufferedWrite = currentCallBuffer.get(memoryId);
        if (currentCallBufferedWrite) {
          baseStats = {
            memory_id: memoryId,
            recall_count: currentCallBufferedWrite.recallCount,
            success_count: currentCallBufferedWrite.successCount,
            failure_count: currentCallBufferedWrite.failureCount,
            avg_confidence: currentCallBufferedWrite.avgConfidence,
            last_recalled_at: currentCallBufferedWrite.lastRecalledAt ? new Date(currentCallBufferedWrite.lastRecalledAt) : undefined,
            created_at: new Date(),
            updated_at: new Date()
          };
        }

        // 통계 업데이트 계산
        const newRecallCount = baseStats.recall_count + 1;
        const newSuccessCount = baseStats.success_count + (isSuccess ? 1 : 0);
        const newFailureCount = baseStats.failure_count + (isSuccess ? 0 : 1);
        const newAvgConfidence = this.updateAvgConfidence(
          baseStats.avg_confidence,
          baseStats.recall_count,
          confidence
        );
        const lastRecalledAt = new Date().toISOString();

        // 현재 호출의 버퍼에 저장 (같은 호출 내에서 같은 memory_id가 여러 번 나타나는 경우 처리)
        const write: MetaMemoryStatsWrite = {
          memoryId,
          recallCount: newRecallCount,
          successCount: newSuccessCount,
          failureCount: newFailureCount,
          avgConfidence: newAvgConfidence,
          lastRecalledAt
        };
        currentCallBuffer.set(memoryId, write);

        // meta_memory_stats 업데이트를 위한 버퍼에 추가 (debounce 처리)
        this.addToStatsBuffer(write);
      } catch (error) {
        // 개별 항목 처리 실패는 로깅하고 계속 진행
        logger.error('MetaMemoryService: recall 통계 기록 실패', {
          error: error instanceof Error ? error.message : String(error),
          memory_id: item.memory_id || item.id
        });
      }
    }
  }

  /**
   * 통계 버퍼에 추가 (WriteCoalescingManager와 연동)
   */
  private statsBuffer: Map<string, MetaMemoryStatsWrite> = new Map();
  private statsFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private addToStatsBuffer(write: MetaMemoryStatsWrite): void {
    // 같은 memoryId에 대한 연속 업데이트는 마지막 것만 유지 (debounce)
    this.statsBuffer.set(write.memoryId, write);

    // Debounce 타이머 시작
    this.scheduleStatsFlush();
  }

  /**
   * 통계 Flush 스케줄링
   */
  private scheduleStatsFlush(): void {
    // 기존 타이머 취소
    if (this.statsFlushTimer) {
      clearTimeout(this.statsFlushTimer);
    }

    // 새 타이머 시작
    this.statsFlushTimer = setTimeout(async () => {
      await this.flushStats();
    }, this.flushInterval);
  }

  /**
   * 통계 버퍼 내용을 데이터베이스에 flush
   */
  private async flushStats(): Promise<void> {
    if (this.statsBuffer.size === 0) {
      return;
    }

    try {
      const writes = Array.from(this.statsBuffer.values());
      this.statsBuffer.clear();

      await this.flushToDatabase(writes);
    } catch (error) {
      // flush 실패 시 로깅 (버퍼는 이미 비워졌으므로 재시도 불가)
      logger.error('MetaMemoryService: 통계 flush 실패', {
        error: error instanceof Error ? error.message : String(error),
        buffer_size: this.statsBuffer.size
      });
      // 에러를 다시 throw하지 않음 (서비스가 계속 동작하도록)
    }
  }

  /**
   * 항목 성공/실패 판정
   * 
   * @param item 검색 결과 항목
   * @returns 성공 여부 (final_score >= 0.5)
   */
  isItemSuccess(item: RecallResultItem): boolean {
    const raw = item.final_score ?? (item as Record<string, unknown>).finalScore;
    const finalScore = typeof raw === 'number' ? raw : Number(raw ?? 0);
    return finalScore >= 0.5;
  }

  /**
   * Confidence 점수 계산
   * 
   * @param item 검색 결과 항목
   * @returns confidence 점수 (0.0 ~ 1.0)
   */
  calculateConfidence(item: RecallResultItem): number {
    const rawFinal = item.final_score ?? (item as Record<string, unknown>).finalScore;
    const finalScore = typeof rawFinal === 'number' ? rawFinal : Number(rawFinal ?? 0);

    const rawConsolidation = (item as Record<string, unknown>).consolidation_score;
    const consolidationScore = typeof rawConsolidation === 'number' ? rawConsolidation : Number(rawConsolidation ?? 0);

    const rawVector = (item as Record<string, unknown>).vectorScore;
    const vectorScore = typeof rawVector === 'number' ? rawVector : Number(rawVector ?? 0);

    return (
      0.6 * finalScore +
      0.3 * consolidationScore +
      0.1 * vectorScore
    );
  }

  /**
   * 평균 confidence 점수 업데이트 (누적 평균 계산)
   * 
   * @param currentAvg 현재 평균 confidence
   * @param currentCount 현재 recall_count
   * @param newConfidence 새로운 confidence 점수
   * @returns 업데이트된 평균 confidence 점수
   */
  updateAvgConfidence(
    currentAvg: number,
    currentCount: number,
    newConfidence: number
  ): number {
    const totalConfidence = currentAvg * currentCount;
    const newTotalConfidence = totalConfidence + newConfidence;
    const newRecallCount = currentCount + 1;

    return newTotalConfidence / newRecallCount;
  }

  /**
   * 통계 조회 (단일 메모리 ID)
   * 
   * @param memoryId 메모리 ID
   * @returns 통계 정보 (없으면 기본값 반환)
   */
  async getStatsById(memoryId: string): Promise<MetaMemoryStats> {
    if (!memoryId || typeof memoryId !== 'string') {
      logger.warn('MetaMemoryService: 유효하지 않은 memoryId', { memoryId });
      throw new Error('memoryId는 필수이며 문자열이어야 합니다');
    }

    try {
      const stmt = this.db.prepare(`
        SELECT 
          memory_id,
          recall_count,
          success_count,
          failure_count,
          avg_confidence,
          last_recalled_at,
          created_at,
          updated_at
        FROM meta_memory_stats
        WHERE memory_id = ?
      `);

      const row = stmt.get(memoryId) as any;

      if (!row) {
        // 기본값 반환
        return {
          memory_id: memoryId,
          recall_count: 0,
          success_count: 0,
          failure_count: 0,
          avg_confidence: 0.0,
          created_at: new Date(),
          updated_at: new Date()
        };
      }

      return this.mapRowToMetaMemoryStats(row);
    } catch (error) {
      logger.error('MetaMemoryService: 통계 조회 실패', {
        error: error instanceof Error ? error.message : String(error),
        memory_id: memoryId
      });
      // 에러 발생 시 기본값 반환 (서비스가 계속 동작하도록)
      return {
        memory_id: memoryId,
        recall_count: 0,
        success_count: 0,
        failure_count: 0,
        avg_confidence: 0.0,
        created_at: new Date(),
        updated_at: new Date()
      };
    }
  }

  /**
   * 통계 조회 (필터링 지원)
   * 
   * @param params 필터링 파라미터
   * @returns 필터링된 통계 결과
   */
  async getStats(params: GetMetaMemoryStatsParams = {}): Promise<MetaMemoryStatsResult> {
    try {
      const {
        memory_id,
        memory_ids,
        min_recall_count,
        min_confidence,
        limit = 100
      } = params;

      // 입력 검증
      if (limit < 1 || limit > 1000) {
        logger.warn('MetaMemoryService: limit 값이 유효 범위를 벗어남', { limit });
        throw new Error('limit은 1 이상 1000 이하여야 합니다');
      }

      // WHERE 조건 구성
      const conditions: string[] = [];
      const queryParams: (string | number)[] = [];

      // memory_id 필터
      if (memory_id) {
        if (typeof memory_id !== 'string') {
          throw new Error('memory_id는 문자열이어야 합니다');
        }
        conditions.push('memory_id = ?');
        queryParams.push(memory_id);
      }

      // memory_ids 필터
      if (memory_ids && memory_ids.length > 0) {
        if (!Array.isArray(memory_ids) || memory_ids.some(id => typeof id !== 'string')) {
          throw new Error('memory_ids는 문자열 배열이어야 합니다');
        }
        const placeholders = memory_ids.map(() => '?').join(', ');
        conditions.push(`memory_id IN (${placeholders})`);
        queryParams.push(...memory_ids);
      }

      // min_recall_count 필터
      if (min_recall_count !== undefined) {
        if (typeof min_recall_count !== 'number' || min_recall_count < 0) {
          throw new Error('min_recall_count는 0 이상의 숫자여야 합니다');
        }
        conditions.push('recall_count >= ?');
        queryParams.push(min_recall_count);
      }

      // min_confidence 필터
      if (min_confidence !== undefined) {
        if (typeof min_confidence !== 'number' || min_confidence < 0 || min_confidence > 1) {
          throw new Error('min_confidence는 0 이상 1 이하의 숫자여야 합니다');
        }
        conditions.push('avg_confidence >= ?');
        queryParams.push(min_confidence);
      }

      // WHERE 절 구성
      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      // 전체 개수 조회
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM meta_memory_stats
        ${whereClause}
      `);

      const countResult = countStmt.get(...queryParams) as { count: number };
      const totalCount = countResult.count;

      // 데이터 조회 (정렬: recall_count DESC, avg_confidence DESC)
      const dataStmt = this.db.prepare(`
        SELECT 
          memory_id,
          recall_count,
          success_count,
          failure_count,
          avg_confidence,
          last_recalled_at,
          created_at,
          updated_at
        FROM meta_memory_stats
        ${whereClause}
        ORDER BY recall_count DESC, avg_confidence DESC
        LIMIT ?
      `);

      const rows = dataStmt.all(...queryParams, limit) as MetaMemoryStatsRow[];

      const items: MetaMemoryStats[] = rows.map(row => this.mapRowToMetaMemoryStats(row));

      return {
        items,
        total_count: totalCount
      };
    } catch (error) {
      logger.error('MetaMemoryService: 통계 조회 실패', {
        error: error instanceof Error ? error.message : String(error),
        params
      });
      // 에러 발생 시 빈 결과 반환 (서비스가 계속 동작하도록)
      return {
        items: [],
        total_count: 0
      };
    }
  }

  /**
   * 데이터베이스 row를 MetaMemoryStats로 매핑
   * 
   * @param row 데이터베이스 row
   * @returns MetaMemoryStats 객체
   */
  private mapRowToMetaMemoryStats(row: MetaMemoryStatsRow): MetaMemoryStats {
    return {
      memory_id: row.memory_id,
      recall_count: row.recall_count,
      success_count: row.success_count,
      failure_count: row.failure_count,
      avg_confidence: row.avg_confidence,
      last_recalled_at: row.last_recalled_at ? new Date(row.last_recalled_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }


  /**
   * 데이터베이스에 통계 업데이트
   * 
   * @param writes 업데이트할 통계 배열
   */
  private async flushToDatabase(writes: MetaMemoryStatsWrite[]): Promise<void> {
    if (writes.length === 0) {
      return;
    }

    try {
      await DatabaseUtils.runTransaction(this.db, async () => {
        for (const write of writes) {
          // 입력 검증
          if (!write.memoryId || typeof write.memoryId !== 'string') {
            logger.warn('MetaMemoryService: 유효하지 않은 write 데이터', { write });
            continue;
          }

          // UPSERT (INSERT OR UPDATE)
          const stmt = this.db.prepare(`
            INSERT INTO meta_memory_stats (
              memory_id,
              recall_count,
              success_count,
              failure_count,
              avg_confidence,
              last_recalled_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(memory_id) DO UPDATE SET
              recall_count = ?,
              success_count = ?,
              failure_count = ?,
              avg_confidence = ?,
              last_recalled_at = ?,
              updated_at = CURRENT_TIMESTAMP
          `);

          stmt.run(
            write.memoryId,
            write.recallCount,
            write.successCount,
            write.failureCount,
            write.avgConfidence,
            write.lastRecalledAt,
            // ON CONFLICT UPDATE 값들
            write.recallCount,
            write.successCount,
            write.failureCount,
            write.avgConfidence,
            write.lastRecalledAt
          );
        }
      });
    } catch (error) {
      logger.error('MetaMemoryService: 데이터베이스 업데이트 실패', {
        error: error instanceof Error ? error.message : String(error),
        writes_count: writes.length
      });
      throw error; // 상위로 전파하여 재시도 가능하도록
    }
  }

  /**
   * 리소스 정리
   */
  async destroy(): Promise<void> {
    try {
      // 남은 통계 버퍼 내용 flush
      await this.flushStats();
    } catch (error) {
      logger.error('MetaMemoryService: destroy 중 flush 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 타이머 정리
    if (this.statsFlushTimer) {
      clearTimeout(this.statsFlushTimer);
      this.statsFlushTimer = null;
    }

    // WriteCoalescingManager 정리
    if (this.writeCoalescingManager) {
      try {
        await this.writeCoalescingManager.destroy();
      } catch (error) {
        logger.error('MetaMemoryService: WriteCoalescingManager destroy 실패', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
