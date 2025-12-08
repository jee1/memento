/**
 * Consolidation Score Worker
 * 배치 재계산 작업을 수행하는 워커 클래스
 * 
 * - 시간당 증분 재계산: 최근 1~12시간 내 갱신된 레코드만 재계산
 * - 야간 전체 스윕: 전체 레코드 재계산
 * - 바닥값/상한 재적용
 */

import Database from 'better-sqlite3';
import { ConsolidationScoreService } from '../infrastructure/consolidation-score-service.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import type { MemoryType } from '../shared/types/index.js';

export interface ConsolidationScoreWorkerConfig {
  // 배치 처리 설정
  batchSize: number;              // 한 번에 처리할 최대 레코드 수 (기본: 1000)
  chunkSize: number;              // 청크 단위 처리 크기 (기본: 100)
  delayBetweenChunks: number;      // 청크 간 지연 시간 (밀리초, 기본: 100)
  
  // 증분 재계산 설정
  incrementalHours: number;       // 증분 재계산 시간 범위 (기본: 12시간)
  
  // 점수 범위 설정
  minScore: number;               // 최소 점수 (바닥값, 기본: 0.0)
  maxScore: number;               // 최대 점수 (상한, 기본: 1.0)
  pinnedMinScore: number;         // 핀 고정 메모리 최소 점수 (기본: 0.25)
  
  // 로깅 설정
  enableLogging: boolean;         // 로깅 활성화 (기본: true)
  logProgressInterval: number;    // 진행 상황 로깅 간격 (레코드 수, 기본: 1000)
}

export interface ConsolidationScoreRecalculationResult {
  jobType: 'incremental' | 'full_sweep';
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  processed: number;
  updated: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  details?: {
    batchesProcessed: number;
    chunksProcessed: number;
    avgProcessingTime: number;
    minScore: number;
    maxScore: number;
    scoreDistribution?: {
      high: number;      // >= 0.8
      medium: number;    // 0.4 ~ 0.8
      low: number;       // < 0.4
    };
  };
}

/**
 * Consolidation Score Worker
 */
export class ConsolidationScoreWorker {
  private config: ConsolidationScoreWorkerConfig;
  private consolidationScoreService: ConsolidationScoreService;

  constructor(config?: Partial<ConsolidationScoreWorkerConfig>) {
    this.config = {
      batchSize: 1000,
      chunkSize: 100,
      delayBetweenChunks: 100,
      incrementalHours: 12,
      minScore: 0.0,
      maxScore: 1.0,
      pinnedMinScore: 0.25,
      enableLogging: true,
      logProgressInterval: 1000,
      ...config
    };

    this.consolidationScoreService = new ConsolidationScoreService();
  }

  /**
   * 시간당 증분 재계산
   * 최근 N시간 내 갱신된 레코드만 재계산
   * 
   * @param db 데이터베이스 연결
   * @param hours 재계산할 시간 범위 (기본값: config.incrementalHours)
   * @returns 재계산 결과
   */
  async runIncrementalRecalculation(
    db: Database.Database,
    hours?: number
  ): Promise<ConsolidationScoreRecalculationResult> {
    const startTime = new Date();
    const result: ConsolidationScoreRecalculationResult = {
      jobType: 'incremental',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      warnings: []
    };

    const targetHours = hours ?? this.config.incrementalHours;
    const cutoffTime = new Date(Date.now() - targetHours * 60 * 60 * 1000);

    try {
      this.log(`Starting incremental recalculation (last ${targetHours} hours)`, {
        cutoffTime: cutoffTime.toISOString()
      });

      // 최근 갱신된 레코드 조회 (last_accessed_at 또는 created_at 기준)
      const records = this.fetchRecentRecords(db, cutoffTime);
      
      if (records.length === 0) {
        this.log('No records to process for incremental recalculation');
        result.success = true;
        result.endTime = new Date();
        result.duration = result.endTime.getTime() - result.startTime.getTime();
        return result;
      }

      this.log(`Found ${records.length} records to process`);

      // 배치 단위로 처리
      const batches = this.chunkArray(records, this.config.batchSize);
      let batchesProcessed = 0;
      let chunksProcessed = 0;
      const processingTimes: number[] = [];

      for (const batch of batches) {
        // 청크 단위로 처리
        const chunks = this.chunkArray(batch, this.config.chunkSize);
        
        for (const chunk of chunks) {
          const chunkStartTime = Date.now();
          
          const chunkResult = await this.processChunk(db, chunk);
          
          result.processed += chunkResult.processed;
          result.updated += chunkResult.updated;
          result.skipped += chunkResult.skipped;
          
          if (chunkResult.errors.length > 0) {
            result.errors.push(...chunkResult.errors);
          }
          
          chunksProcessed++;
          processingTimes.push(Date.now() - chunkStartTime);
          
          // 진행 상황 로깅
          if (result.processed % this.config.logProgressInterval === 0) {
            this.log(`Progress: ${result.processed} processed, ${result.updated} updated, ${result.skipped} skipped`);
          }
          
          // 청크 간 지연
          if (chunks.length > 1) {
            await this.delay(this.config.delayBetweenChunks);
          }
        }
        
        batchesProcessed++;
        
        this.log(`Batch ${batchesProcessed}/${batches.length} completed`, {
          processed: result.processed,
          updated: result.updated,
          skipped: result.skipped
        });
      }

      // 결과 요약
      const avgProcessingTime = processingTimes.length > 0
        ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
        : 0;

      result.success = result.errors.length === 0;
      result.details = {
        batchesProcessed,
        chunksProcessed,
        avgProcessingTime,
        minScore: this.config.minScore,
        maxScore: this.config.maxScore
      };

      this.log('Incremental recalculation completed', {
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
        duration: result.duration
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Incremental recalculation failed', { error }, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * 야간 전체 스윕
   * 전체 레코드 재계산
   * 
   * @param db 데이터베이스 연결
   * @returns 재계산 결과
   */
  async runFullSweep(db: Database.Database): Promise<ConsolidationScoreRecalculationResult> {
    const startTime = new Date();
    const result: ConsolidationScoreRecalculationResult = {
      jobType: 'full_sweep',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      warnings: []
    };

    try {
      this.log('Starting full sweep recalculation');

      // 전체 레코드 조회
      const records = this.fetchAllRecords(db);
      
      if (records.length === 0) {
        this.log('No records to process for full sweep');
        result.success = true;
        result.endTime = new Date();
        result.duration = result.endTime.getTime() - result.startTime.getTime();
        return result;
      }

      this.log(`Found ${records.length} records to process`);

      // 배치 단위로 처리
      const batches = this.chunkArray(records, this.config.batchSize);
      let batchesProcessed = 0;
      let chunksProcessed = 0;
      const processingTimes: number[] = [];
      const scoreDistribution = { high: 0, medium: 0, low: 0 };

      for (const batch of batches) {
        // 청크 단위로 처리
        const chunks = this.chunkArray(batch, this.config.chunkSize);
        
        for (const chunk of chunks) {
          const chunkStartTime = Date.now();
          
          const chunkResult = await this.processChunk(db, chunk);
          
          result.processed += chunkResult.processed;
          result.updated += chunkResult.updated;
          result.skipped += chunkResult.skipped;
          
          // 점수 분포 집계
          for (const record of chunkResult.scores) {
            if (record.score >= 0.8) {
              scoreDistribution.high++;
            } else if (record.score >= 0.4) {
              scoreDistribution.medium++;
            } else {
              scoreDistribution.low++;
            }
          }
          
          if (chunkResult.errors.length > 0) {
            result.errors.push(...chunkResult.errors);
          }
          
          chunksProcessed++;
          processingTimes.push(Date.now() - chunkStartTime);
          
          // 진행 상황 로깅
          if (result.processed % this.config.logProgressInterval === 0) {
            this.log(`Progress: ${result.processed} processed, ${result.updated} updated, ${result.skipped} skipped`);
          }
          
          // 청크 간 지연
          if (chunks.length > 1) {
            await this.delay(this.config.delayBetweenChunks);
          }
        }
        
        batchesProcessed++;
        
        this.log(`Batch ${batchesProcessed}/${batches.length} completed`, {
          processed: result.processed,
          updated: result.updated,
          skipped: result.skipped
        });
      }

      // 결과 요약
      const avgProcessingTime = processingTimes.length > 0
        ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
        : 0;

      result.success = result.errors.length === 0;
      result.details = {
        batchesProcessed,
        chunksProcessed,
        avgProcessingTime,
        minScore: this.config.minScore,
        maxScore: this.config.maxScore,
        scoreDistribution
      };

      this.log('Full sweep recalculation completed', {
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
        duration: result.duration,
        scoreDistribution
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Full sweep recalculation failed', { error }, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * 최근 갱신된 레코드 조회
   * last_accessed_at 또는 created_at 기준으로 최근 N시간 내 레코드 조회
   */
  private fetchRecentRecords(db: Database.Database, cutoffTime: Date): Array<{
    id: string;
    recall_count: number;
    last_accessed_at: string | null;
    created_at: string;
    type: MemoryType;
    pinned: boolean | number;
    g_value: number | null;
  }> {
    const cutoffISO = cutoffTime.toISOString();
    
    const sql = `
      SELECT 
        id,
        recall_count,
        last_accessed_at,
        created_at,
        type,
        pinned,
        g_value
      FROM memory_item
      WHERE 
        (last_accessed_at IS NOT NULL AND last_accessed_at >= ?)
        OR (last_accessed_at IS NULL AND created_at >= ?)
      ORDER BY 
        COALESCE(last_accessed_at, created_at) DESC
    `;
    
    return db.prepare(sql).all(cutoffISO, cutoffISO) as Array<{
      id: string;
      recall_count: number;
      last_accessed_at: string | null;
      created_at: string;
      type: MemoryType;
      pinned: boolean | number;
      g_value: number | null;
    }>;
  }

  /**
   * 전체 레코드 조회
   */
  private fetchAllRecords(db: Database.Database): Array<{
    id: string;
    recall_count: number;
    last_accessed_at: string | null;
    created_at: string;
    type: MemoryType;
    pinned: boolean | number;
    g_value: number | null;
  }> {
    const sql = `
      SELECT 
        id,
        recall_count,
        last_accessed_at,
        created_at,
        type,
        pinned,
        g_value
      FROM memory_item
      ORDER BY created_at DESC
    `;
    
    return db.prepare(sql).all() as Array<{
      id: string;
      recall_count: number;
      last_accessed_at: string | null;
      created_at: string;
      type: MemoryType;
      pinned: boolean | number;
      g_value: number | null;
    }>;
  }

  /**
   * 청크 단위 처리
   */
  private async processChunk(
    db: Database.Database,
    chunk: Array<{
      id: string;
      recall_count: number;
      last_accessed_at: string | null;
      created_at: string;
      type: MemoryType;
      pinned: boolean | number;
      g_value: number | null;
    }>
  ): Promise<{
    processed: number;
    updated: number;
    skipped: number;
    errors: string[];
    scores: Array<{ id: string; score: number }>;
  }> {
    const result = {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      scores: [] as Array<{ id: string; score: number }>
    };

    const now = new Date();

    // 트랜잭션 내에서 처리
    await DatabaseUtils.runTransaction(db, async () => {
      for (const record of chunk) {
        try {
          result.processed++;

          // last_accessed_at이 없으면 created_at 사용
          const lastAccessedAt = record.last_accessed_at
            ? new Date(record.last_accessed_at)
            : new Date(record.created_at);
          
          const createdAt = new Date(record.created_at);

          // 경과 시간 계산
          const timeElapsed = this.consolidationScoreService.calculateTimeElapsed(
            lastAccessedAt,
            createdAt,
            now
          );

          // g_value 재계산 (필요한 경우)
          let gValue = record.g_value;
          if (gValue === null || record.recall_count === 0) {
            // g_value가 없거나 recall_count가 0이면 처음부터 재계산
            gValue = this.consolidationScoreService.recalculateGValue(
              record.recall_count,
              timeElapsed
            );
          }

          // consolidation_score 계산
          const scoreResult = this.consolidationScoreService.calculateScore({
            recallCount: record.recall_count,
            lastAccessedAt,
            createdAt,
            gValue,
            type: record.type,
            pinned: record.pinned === 1 || record.pinned === true
          });

          // 바닥값/상한 재적용
          let finalScore = scoreResult.score;
          
          // 핀 고정 메모리는 최소 바닥값 보장
          if (record.pinned === 1 || record.pinned === true) {
            finalScore = Math.max(finalScore, this.config.pinnedMinScore);
          }
          
          // 일반 바닥값/상한 적용
          finalScore = Math.max(finalScore, this.config.minScore);
          finalScore = Math.min(finalScore, this.config.maxScore);

          // 점수 변경이 있는 경우에만 업데이트
          const currentScore = this.getCurrentScore(db, record.id);
          if (currentScore === null || Math.abs(currentScore - finalScore) > 0.001) {
            // 업데이트 실행
            DatabaseUtils.run(
              db,
              `UPDATE memory_item 
               SET consolidation_score = ?, g_value = ?
               WHERE id = ?`,
              [finalScore, gValue, record.id]
            );
            
            result.updated++;
            result.scores.push({ id: record.id, score: finalScore });
          } else {
            result.skipped++;
          }

        } catch (error) {
          result.errors.push(
            `Record ${record.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });

    return result;
  }

  /**
   * 현재 consolidation_score 조회
   */
  private getCurrentScore(db: Database.Database, memoryId: string): number | null {
    const result = db.prepare(
      'SELECT consolidation_score FROM memory_item WHERE id = ?'
    ).get(memoryId) as { consolidation_score: number | null } | undefined;
    
    return result?.consolidation_score ?? null;
  }

  /**
   * 배열을 청크로 분할
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 지연 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 로깅
   */
  private log(message: string, data?: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ConsolidationScoreWorker] [${level.toUpperCase()}] ${message}`;
    
    const logData = data ? JSON.stringify(data, null, 2) : '';
    
    switch (level) {
      case 'error':
        console.error(logMessage, logData);
        break;
      case 'warn':
        console.warn(logMessage, logData);
        break;
      default:
        console.log(logMessage, logData);
    }
  }
}

