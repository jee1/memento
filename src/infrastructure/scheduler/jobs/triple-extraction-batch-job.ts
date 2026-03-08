/**
 * Triple 추출 배치 작업
 * 
 * 미처리 또는 실패한 Episodic Memory에 대해 Triple 추출을 수행하는 배치 작업입니다.
 * 
 * 주요 기능:
 * - 미처리 Episodic Memory 조회
 * - Triple 추출 및 Semantic Memory 생성
 * - 재시도 정책 적용 (최대 3회, 지수 백오프: 1일, 2일, 4일)
 * - 상태 업데이트 (성공/실패/abandoned)
 * - 로깅 및 통계 수집
 * 
 * 재시도 정책:
 * - 최대 시도 횟수: 3회 (설정 가능)
 * - 지수 백오프: 1일, 2일, 4일 후 재시도
 * - 즉각 재시도 금지: LLM 호출 실패 시 바로 재시도하지 않음 (비용 절감)
 * - 지연 재시도: 배치 작업에서 실패한 항목을 다음 배치에서 재시도
 * - 최대 시도 횟수 초과 시: abandoned 상태로 설정하여 재시도 중단
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { TripleExtractionService } from '../../../domains/relation/services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from '../../../domains/memory/services/semantic-memory/semantic-memory-update-service.js';
import { logger } from '../../../shared/utils/logger.js';
import type { BatchJobResult } from '../batch-scheduler.js';

/**
 * Triple 추출 배치 작업 설정
 */
export interface TripleExtractionBatchJobConfig {
  /**
   * 배치 크기 (한 번에 처리할 최대 메모리 수)
   * 기본값: 10
   */
  batchSize?: number;
  
  /**
   * 작업 타임아웃 (밀리초)
   * 기본값: 30000 (30초)
   */
  timeout?: number;
  
  /**
   * 최대 재시도 횟수
   * 기본값: 3
   */
  maxRetries?: number;
  
  /**
   * 재시도 백오프 간격 (일 단위)
   * 기본값: [1, 2, 4] (1일, 2일, 4일)
   */
  retryBackoffDays?: number[];
  
  /**
   * SQLite WAL 환경 고려: 청크 크기 (작은 단위로 나누어 처리하여 Lock 충돌 방지)
   * 기본값: 5 (한 번에 5개씩 처리)
   */
  chunkSize?: number;
  
  /**
   * SQLite WAL 환경 고려: 청크 처리 사이 지연 시간 (밀리초)
   * 기본값: 100 (0.1초)
   */
  chunkDelayMs?: number;
  
  /**
   * 병렬성 제어 (동시 실행 배치 수)
   * 기본값: 1 (싱글톤 배치 작업)
   */
  parallelism?: number;
}

/**
 * Triple 추출 배치 작업 결과
 */
export interface TripleExtractionBatchResult extends BatchJobResult {
  details: {
    processed: number;              // 처리된 Episodic Memory 수
    success: number;                // 성공한 수
    failed: number;                 // 실패한 수
    skipped: number;                // 건너뛴 수 (재시도 대기 중)
    semanticMemoriesCreated: number; // 생성된 Semantic Memory 수
    semanticMemoriesUpdated: number; // 업데이트된 Semantic Memory 수
    retryCounts: Map<string, number>; // 각 메모리별 재시도 횟수
  };
  /**
   * 타임아웃 발생 여부
   * 타임아웃이 발생하여 작업이 중단된 경우 true
   */
  timeoutOccurred?: boolean;
}

/**
 * Triple 추출 배치 작업 클래스
 */
export class TripleExtractionBatchJob {
  private config: Required<TripleExtractionBatchJobConfig>;
  private tripleExtractionService: TripleExtractionService;
  private semanticMemoryUpdateService: SemanticMemoryUpdateService | null = null;

  constructor(
    config?: TripleExtractionBatchJobConfig,
    dependencies?: {
      tripleExtractionService?: TripleExtractionService;
      semanticMemoryUpdateService?: SemanticMemoryUpdateService;
    }
  ) {
    this.config = {
      batchSize: config?.batchSize ?? 10, // PRD 6.2: 배치 크기 10개
      timeout: config?.timeout ?? 30000, // PRD 6.2: 타임아웃 30초
      maxRetries: config?.maxRetries ?? 3,
      retryBackoffDays: config?.retryBackoffDays ?? [1, 2, 4],
      chunkSize: config?.chunkSize ?? 5, // SQLite WAL 환경 고려: 작은 단위로 처리
      chunkDelayMs: config?.chunkDelayMs ?? 100, // 청크 사이 짧은 지연
      parallelism: config?.parallelism ?? 1, // PRD 6.2: 병렬성 제어, 기본값 1 (싱글톤 배치 작업)
      ...config
    };

    this.tripleExtractionService = dependencies?.tripleExtractionService ?? new TripleExtractionService();
    this.semanticMemoryUpdateService = dependencies?.semanticMemoryUpdateService ?? null;
  }

  /**
   * 배치 작업 실행
   * 
   * PRD 6.2 배치 처리 최적화:
   * - 배치 크기: 10개씩 처리 (설정 가능)
   * - 타임아웃: 배치당 최대 30초 (설정 가능)
   * - 병렬성 제어: Parallelism = 1 (동시에 하나의 배치만 실행)
   * 
   * @param db 데이터베이스 연결
   * @returns 배치 작업 결과
   */
  async execute(db: Database.Database): Promise<TripleExtractionBatchResult> {
    const startTime = new Date();
    const timeoutDeadline = startTime.getTime() + this.config.timeout;
    const result: TripleExtractionBatchResult = {
      jobType: 'triple_extraction_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: [],
      details: {
        processed: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        semanticMemoriesCreated: 0,
        semanticMemoriesUpdated: 0,
        retryCounts: new Map()
      }
    };

    try {
      // PRD 6.3: 배치 작업 로깅 - 시작 로깅
      logger.info('Starting triple extraction batch job', {
        batchSize: this.config.batchSize,
        timeout: `${this.config.timeout}ms`,
        parallelism: 1, // PRD 6.2: 병렬성 제어, 기본값 1 (싱글톤 배치 작업)
        chunkSize: this.config.chunkSize,
        chunkDelayMs: this.config.chunkDelayMs,
        maxRetries: this.config.maxRetries,
        retryBackoffDays: this.config.retryBackoffDays
      });

      // SemanticMemoryUpdateService 초기화 (아직 초기화되지 않은 경우)
      if (!this.semanticMemoryUpdateService) {
        this.semanticMemoryUpdateService = new SemanticMemoryUpdateService(db);
      }

      // 배치 작업 대상 조회
      const targetMemories = await this.getTargetMemories(db, this.config.batchSize);

      // PRD 6.3: 배치 작업 로깅 - 대상 조회 결과
      logger.info('Found target memories for triple extraction', {
        count: targetMemories.length,
        batchSize: this.config.batchSize,
        chunkSize: this.config.chunkSize,
        estimatedChunks: Math.ceil(targetMemories.length / this.config.chunkSize),
        estimatedDuration: targetMemories.length > 0
          ? `${Math.ceil((targetMemories.length * 3) / 60)} minutes (estimated)`
          : '0 minutes'
      });

      // SQLite WAL 환경 고려: 작은 청크 단위로 나누어 처리하여 Lock 충돌 방지
      // PRD 6.1: 배치 작업은 단일 트랜잭션으로 처리하지 않고, 작은 단위로 나누어 처리
      const chunks = this.splitIntoChunks(targetMemories, this.config.chunkSize);
      
      logger.debug('Split memories into chunks for WAL-safe processing', {
        totalMemories: targetMemories.length,
        chunkCount: chunks.length,
        chunkSize: this.config.chunkSize
      });

      // 각 청크를 순차적으로 처리 (PRD 6.2: 병렬성 제어, parallelism=1)
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        // 타임아웃 체크 (PRD 6.2: 배치당 최대 30초)
        const currentTime = Date.now();
        if (currentTime >= timeoutDeadline) {
          const elapsed = currentTime - startTime.getTime();
          result.warnings.push(`Batch job timeout after ${elapsed}ms (limit: ${this.config.timeout}ms)`);
          result.timeoutOccurred = true; // 타임아웃 플래그 설정
          logger.warn('Triple extraction batch job timeout', {
            elapsed,
            timeout: this.config.timeout,
            processed: result.details.processed,
            remainingChunks: chunks.length - chunkIndex
          });
          break; // 타임아웃 발생 시 처리 중단
        }
        
        const chunk = chunks[chunkIndex];
        if (!chunk) {
          // 청크가 없으면 건너뛰기
          continue;
        }
        
        try {
          // 청크 단위로 처리 (작은 트랜잭션으로 Lock 충돌 방지)
          const chunkResult = await this.processChunk(db, chunk, result, timeoutDeadline);
          
          // 청크 처리 결과를 전체 결과에 반영
          result.details.processed += chunkResult.processed;
          result.details.success += chunkResult.success;
          result.details.failed += chunkResult.failed;
          result.details.skipped += chunkResult.skipped;
          result.details.semanticMemoriesCreated += chunkResult.semanticMemoriesCreated;
          result.details.semanticMemoriesUpdated += chunkResult.semanticMemoriesUpdated;
          
          // 청크별 재시도 횟수 반영
          for (const [memoryId, retryCount] of chunkResult.retryCounts) {
            result.details.retryCounts.set(memoryId, retryCount);
          }
          
          // 에러 수집
          result.errors.push(...chunkResult.errors);
          
          // PRD 6.3: 배치 작업 로깅 - 청크 처리 결과
          logger.debug('Chunk processed', {
            chunkIndex: chunkIndex + 1,
            totalChunks: chunks.length,
            chunkSize: chunk?.length ?? 0,
            processed: chunkResult.processed,
            success: chunkResult.success,
            failed: chunkResult.failed,
            skipped: chunkResult.skipped,
            semanticMemoriesCreated: chunkResult.semanticMemoriesCreated,
            semanticMemoriesUpdated: chunkResult.semanticMemoriesUpdated,
            progress: `${((chunkIndex + 1) / chunks.length * 100).toFixed(1)}%`
          });
          
          // 마지막 청크가 아니면 짧은 지연 (SQLite WAL Lock 충돌 방지)
          if (chunkIndex < chunks.length - 1 && this.config.chunkDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.config.chunkDelayMs));
          }
        } catch (error) {
          // 청크 처리 실패 시 에러 기록하고 다음 청크 계속 처리
          const errorMessage = `Failed to process chunk ${chunkIndex + 1}/${chunks.length}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMessage);
          logger.error('Error processing chunk in batch job', {
            chunkIndex: chunkIndex + 1,
            totalChunks: chunks.length,
            error: error instanceof Error ? error.message : String(error)
          });
          
          // 청크 내 모든 메모리를 실패로 처리
          result.details.failed += chunk?.length ?? 0;
          result.details.processed += chunk?.length ?? 0;
        }
      }

      // 배치 작업 성공 여부: 처리된 항목이 있고, 치명적 에러가 없는 경우 성공으로 간주
      // 부분 실패(failed > 0)는 허용 (재시도 정책에 따라 처리됨)
      result.success = result.details.processed > 0;
      result.processed = result.details.processed;

      // PRD 6.3: 배치 작업 로깅
      // - 처리된 Episodic Memory 수
      // - 생성된 Semantic Memory 수
      // - 실패한 항목 수 및 에러 로그
      // - 배치 실행 시간 및 성능 메트릭
      const duration = result.endTime.getTime() - result.startTime.getTime();
      const durationSeconds = (duration / 1000).toFixed(2);
      const avgProcessingTime = result.details.processed > 0 
        ? (duration / result.details.processed).toFixed(0) 
        : '0';
      const successRate = result.details.processed > 0
        ? ((result.details.success / result.details.processed) * 100).toFixed(1)
        : '0.0';
      // 완료 로그는 batch-scheduler의 this.log('Triple extraction batch job completed', ...)에서 한 번만 출력 (중복·undefined 줄 감소)

      // 성능 메트릭 상세 로깅 (디버그 레벨)
      logger.debug('Triple extraction batch job performance metrics', {
        throughput: result.details.processed > 0 
          ? `${(result.details.processed / (duration / 1000)).toFixed(2)} memories/sec`
          : '0 memories/sec',
        semanticMemoryCreationRate: result.details.semanticMemoriesCreated > 0
          ? `${(result.details.semanticMemoriesCreated / (duration / 1000)).toFixed(2)} semantic memories/sec`
          : '0 semantic memories/sec',
        chunkProcessingStats: {
          totalChunks: chunks.length,
          avgChunkSize: chunks.length > 0 
            ? (targetMemories.length / chunks.length).toFixed(1)
            : '0',
          chunkDelayMs: this.config.chunkDelayMs
        },
        retryDistribution: result.details.retryCounts.size > 0
          ? Array.from(result.details.retryCounts.values()).reduce((acc, count) => {
              acc[count] = (acc[count] || 0) + 1;
              return acc;
            }, {} as Record<number, number>)
          : {}
      });

    } catch (error) {
      // PRD 6.3: 배치 작업 로깅 - 에러 로그
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);
      
      const duration = result.endTime.getTime() - result.startTime.getTime();
      logger.error('Triple extraction batch job failed', {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        processed: result.details.processed,
        success: result.details.success,
        failed: result.details.failed,
        duration: `${(duration / 1000).toFixed(2)}s`,
        errors: result.errors,
        warnings: result.warnings
      });
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * 메모리 배열을 청크로 분할
   * 
   * SQLite WAL 환경 고려: 작은 단위로 나누어 처리하여 Lock 충돌 방지
   * 
   * @param memories 메모리 배열
   * @param chunkSize 청크 크기
   * @returns 청크 배열
   */
  private splitIntoChunks<T>(memories: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < memories.length; i += chunkSize) {
      chunks.push(memories.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * 청크 단위 처리
   * 
   * SQLite WAL 환경 고려: 작은 트랜잭션으로 처리하여 Lock 충돌 방지
   * 각 메모리 처리는 개별적으로 처리되며, SQLITE_BUSY 오류 발생 시 재시도
   * 
   * PRD 6.2 배치 처리 최적화:
   * - 타임아웃 체크: 배치당 최대 30초
   * - 병렬성 제어: 순차 처리 (parallelism=1)
   * 
   * @param db 데이터베이스 연결
   * @param chunk 청크 (메모리 배열)
   * @param overallResult 전체 결과 객체 (로깅용)
   * @param timeoutDeadline 타임아웃 데드라인 (타임스탬프)
   * @returns 청크 처리 결과
   */
  private async processChunk(
    db: Database.Database,
    chunk: Array<{
      id: string;
      content: string;
      importance: number | null;
      triple_extracted: number | null;
      triple_extracted_status: string | null;
      triple_extraction_metadata: string | null;
    }>,
    overallResult: TripleExtractionBatchResult,
    timeoutDeadline: number
  ): Promise<{
    processed: number;
    success: number;
    failed: number;
    skipped: number;
    semanticMemoriesCreated: number;
    semanticMemoriesUpdated: number;
    retryCounts: Map<string, number>;
    errors: string[];
  }> {
    const chunkResult = {
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      semanticMemoriesCreated: 0,
      semanticMemoriesUpdated: 0,
      retryCounts: new Map<string, number>(),
      errors: [] as string[]
    };

    // 각 메모리를 개별적으로 처리 (작은 트랜잭션으로 Lock 충돌 방지)
    // PRD 6.2: 병렬성 제어, 순차 처리 (parallelism=1)
    for (const memory of chunk) {
      // 타임아웃 체크 (PRD 6.2: 배치당 최대 30초)
      if (Date.now() >= timeoutDeadline) {
        overallResult.timeoutOccurred = true; // 타임아웃 플래그 설정
        logger.warn('Chunk processing timeout, stopping chunk processing', {
          chunkSize: chunk.length,
          processedInChunk: chunkResult.processed
        });
        break; // 타임아웃 발생 시 청크 처리 중단
      }
      
      try {
        // 재시도 정책 확인 (getTargetMemories에서 이미 필터링되었지만, 이중 확인)
        const shouldRetry = this.shouldRetry(memory);
        if (!shouldRetry) {
          chunkResult.skipped++;
          logger.debug('Skipping memory due to retry policy', {
            memory_id: memory.id,
            retry_count: this.getRetryCount(memory)
          });
          continue;
        }

        // Triple 추출 수행 (LLM 호출, 트랜잭션 외부에서 처리)
        const extractionResult = await this.tripleExtractionService.extractTriples(memory.content);

        if (extractionResult.triples.length > 0) {
          // Semantic Memory 생성/업데이트 (트랜잭션 내부에서 처리)
          // DatabaseUtils.runTransaction은 SQLITE_BUSY 오류 발생 시 자동 재시도
          await DatabaseUtils.runTransaction(db, async () => {
            const updateResult = await this.semanticMemoryUpdateService!.updateSemanticMemory(
              extractionResult,
              {
                episodicMemoryId: memory.id,
                episodicImportance: memory.importance ?? 0.5
              }
            );

            // 성공 상태 업데이트 (트랜잭션 내부)
            const confidenceAvg = await this.calculateAverageConfidence(db, memory.id);
            
            const successMetadata: Record<string, any> = {
              triple_count: extractionResult.triples.length,
              extracted_at: new Date().toISOString()
            };
            
            if (confidenceAvg !== null) {
              successMetadata.confidence_avg = confidenceAvg;
            }
            
            await this.updateMemoryStatus(
              db,
              memory.id,
              'success',
              successMetadata
            );

            chunkResult.success++;
            chunkResult.semanticMemoriesCreated += updateResult.created;
            chunkResult.semanticMemoriesUpdated += updateResult.updated;
          });
        } else {
          // Triple 추출 실패 - 상태 업데이트 (트랜잭션 내부)
          const failureReason = extractionResult.extractionInfo.failureReason || 'no_triple';
          const currentRetryCount = this.getRetryCount(memory);
          const newRetryCount = currentRetryCount + 1;

          await DatabaseUtils.runTransaction(db, async () => {
            // 재시도 정책 적용: 최대 시도 횟수 확인
            if (newRetryCount >= this.config.maxRetries) {
              // 최대 시도 횟수 초과 - abandoned 상태로 설정
              await this.updateMemoryStatus(
                db,
                memory.id,
                'abandoned',
                {
                  failureReason,
                  retry_count: newRetryCount,
                  last_attempt: new Date().toISOString(),
                  abandoned_at: new Date().toISOString()
                }
              );
              
              logger.info('Triple extraction abandoned after max retries', {
                memory_id: memory.id,
                retry_count: newRetryCount,
                max_retries: this.config.maxRetries,
                failure_reason: failureReason
              });
            } else {
              // 재시도 가능 - failed 상태로 업데이트
              const backoffDays = this.config.retryBackoffDays[newRetryCount - 1] || 
                                 this.config.retryBackoffDays[this.config.retryBackoffDays.length - 1];
              
              await this.updateMemoryStatus(
                db,
                memory.id,
                'failed',
                {
                  failureReason,
                  retry_count: newRetryCount,
                  last_attempt: new Date().toISOString(),
                  next_retry_after_days: backoffDays
                }
              );
              
              logger.debug('Triple extraction failed, will retry after backoff', {
                memory_id: memory.id,
                retry_count: newRetryCount,
                backoff_days: backoffDays,
                failure_reason: failureReason
              });
            }
          });

          chunkResult.failed++;
          chunkResult.retryCounts.set(memory.id, newRetryCount);
        }

        chunkResult.processed++;
      } catch (error) {
        // SQLITE_BUSY 오류는 DatabaseUtils.runTransaction에서 이미 재시도됨
        // 여기서는 예상치 못한 오류만 처리
        const errorMessage = `Failed to process memory ${memory.id}: ${error instanceof Error ? error.message : String(error)}`;
        chunkResult.errors.push(errorMessage);
        chunkResult.failed++;
        chunkResult.processed++;
        
        logger.error('Error processing episodic memory in batch job', {
          memory_id: memory.id,
          error: error instanceof Error ? error.message : String(error),
          error_code: (error as any)?.code
        });
      }
    }

    return chunkResult;
  }

  /**
   * 배치 작업 대상 조회
   * 
   * @param db 데이터베이스 연결
   * @param limit 최대 조회 개수
   * @returns 대상 Episodic Memory 목록 (재시도 정책 적용)
   */
  private async getTargetMemories(
    db: Database.Database,
    limit: number
  ): Promise<Array<{ 
    id: string; 
    content: string; 
    importance: number | null;
    triple_extracted: number | null;
    triple_extracted_status: string | null;
    triple_extraction_metadata: string | null;
  }>> {
    // 미처리 또는 실패한 Episodic Memory 조회
    // - triple_extracted=false 또는 null (미처리)
    // - triple_extracted_status='failed' (재시도 가능, 백오프 간격 확인 필요)
    // - triple_extracted_status IS NULL (미처리)
    // - abandoned 상태는 제외 (수동 재시도 필요)
    const memories = DatabaseUtils.all(db, `
      SELECT 
        id, 
        content, 
        importance,
        triple_extracted,
        triple_extracted_status,
        triple_extraction_metadata
      FROM memory_item
      WHERE type = 'episodic'
        AND (
          triple_extracted IS NULL
          OR triple_extracted = 0
          OR triple_extracted_status = 'failed'
        )
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')
      ORDER BY created_at ASC
      LIMIT ?
    `, [limit]) as Array<{ 
      id: string; 
      content: string; 
      importance: number | null;
      triple_extracted: number | null;
      triple_extracted_status: string | null;
      triple_extraction_metadata: string | null;
    }>;

    // 재시도 정책 적용: 백오프 간격이 지나지 않은 항목은 제외
    const now = new Date();
    const filteredMemories = memories.filter(memory => {
      // 미처리 항목은 항상 포함
      if (memory.triple_extracted_status === null || memory.triple_extracted_status === '') {
        return true;
      }

      // failed 상태인 경우 재시도 정책 확인
      if (memory.triple_extracted_status === 'failed') {
        return this.shouldRetry(memory, now);
      }

      return true;
    });

    return filteredMemories;
  }

  /**
   * 재시도 정책 확인
   * 
   * @param memory Episodic Memory (triple_extraction_metadata 포함)
   * @param now 현재 시간
   * @returns 재시도 가능 여부
   */
  private shouldRetry(
    memory: { 
      id: string; 
      triple_extraction_metadata: string | null;
    },
    now: Date = new Date()
  ): boolean {
    // 최대 재시도 횟수 확인
    const retryCount = this.getRetryCount(memory);
    if (retryCount >= this.config.maxRetries) {
      return false; // 최대 시도 횟수 초과
    }

    // 미처리 항목은 항상 재시도 가능
    if (!memory.triple_extraction_metadata) {
      return true;
    }

    try {
      const metadata = JSON.parse(memory.triple_extraction_metadata);
      const lastAttempt = metadata.last_attempt;
      
      if (!lastAttempt) {
        return true; // last_attempt가 없으면 재시도 가능
      }

      // 백오프 간격 확인 (지수 백오프: 1일, 2일, 4일)
      const lastAttemptDate = new Date(lastAttempt);
      const daysSinceLastAttempt = Math.floor(
        (now.getTime() - lastAttemptDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      // 현재 retry_count에 해당하는 백오프 간격 확인
      // retry_count가 0이면 첫 번째 재시도 (1일), 1이면 두 번째 재시도 (2일), 2이면 세 번째 재시도 (4일)
      const backoffDays = this.config.retryBackoffDays[retryCount] ?? 
                         this.config.retryBackoffDays[this.config.retryBackoffDays.length - 1] ?? 1;

      // 백오프 간격이 지났으면 재시도 가능
      return daysSinceLastAttempt >= backoffDays;
    } catch (error) {
      // 메타데이터 파싱 실패 시 재시도 가능으로 간주
      logger.warn('Failed to parse triple_extraction_metadata for retry check', {
        memory_id: memory.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  /**
   * 재시도 횟수 조회
   * 
   * @param memory Episodic Memory (triple_extraction_metadata 포함)
   * @returns 재시도 횟수
   */
  private getRetryCount(memory: { 
    id: string; 
    triple_extraction_metadata: string | null;
  }): number {
    if (!memory.triple_extraction_metadata) {
      return 0; // 메타데이터가 없으면 재시도 횟수 0
    }

    try {
      const metadata = JSON.parse(memory.triple_extraction_metadata);
      return metadata.retry_count || 0;
    } catch (error) {
      logger.warn('Failed to parse triple_extraction_metadata for retry count', {
        memory_id: memory.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * 메모리 상태 업데이트
   * 
   * PRD 1.4 재시도 종료 조건 및 필드 조합 규칙에 따라 상태를 업데이트합니다.
   * 
   * 상태 전이 규칙:
   * - 성공 시: triple_extracted=true, triple_extracted_status='success', 이전 실패 기록 초기화
   * - 최대 시도 횟수 초과 시: triple_extracted=false, triple_extracted_status='abandoned', 재시도 중단
   * - 재시도 가능 시: triple_extracted=false, triple_extracted_status='failed', 재시도 정보 저장
   * 
   * 필드 조합 규칙 (PRD 1.4):
   * | triple_extracted | triple_extracted_status | 의미 |
   * | ---------------- | ----------------------- | ---- |
   * | NULL | NULL | 미처리 |
   * | true | 'success' | 성공 |
   * | false | 'failed' | 실패 (재시도 가능) |
   * | false | 'abandoned' | 포기 (수동 재시도 필요) |
   * | false | NULL | 미처리 또는 초기 상태 |
   * 
   * 이 메서드는 필드 조합 규칙을 준수하여 triple_extracted와 triple_extracted_status를 동기화합니다.
   * 
   * @param db 데이터베이스 연결
   * @param memoryId 메모리 ID
   * @param status 상태 ('success' | 'failed' | 'abandoned')
   * @param metadata 메타데이터
   */
  private async updateMemoryStatus(
    db: Database.Database,
    memoryId: string,
    status: 'success' | 'failed' | 'abandoned',
    metadata: Record<string, any>
  ): Promise<void> {
    // 필드 조합 규칙에 따른 triple_extracted boolean 동기화
    // PRD 1.4 필드 조합 규칙 준수:
    // - 성공: triple_extracted=true, triple_extracted_status='success'
    // - 실패: triple_extracted=false, triple_extracted_status='failed' (재시도 가능)
    // - 포기: triple_extracted=false, triple_extracted_status='abandoned' (수동 재시도 필요)
    // 
    // 상태 전이 시 항상 두 필드를 함께 업데이트하여 일관성 유지
    // 이는 필드 조합 규칙을 보장하기 위한 필수 동기화 로직입니다.
    const tripleExtracted = status === 'success' ? true : false;

    // 필드 조합 규칙 준수: triple_extracted와 triple_extracted_status를 항상 함께 업데이트
    // 이는 데이터 일관성을 보장하기 위한 필수 동기화 로직입니다.
    // SQLite에서는 boolean을 INTEGER로 변환 (true=1, false=0)
    await DatabaseUtils.run(db, `
      UPDATE memory_item SET
        triple_extracted = ?,
        triple_extracted_status = ?,
        triple_extraction_metadata = ?
      WHERE id = ?
    `, [
      tripleExtracted ? 1 : 0, // SQLite에서는 boolean을 INTEGER로 변환
      status,
      JSON.stringify(metadata),
      memoryId
    ]);
    
    // 상태 전이 로깅 (필드 조합 규칙 준수 확인)
    logger.debug('Memory status updated with field combination rule', {
      memory_id: memoryId,
      triple_extracted: tripleExtracted,
      triple_extracted_status: status,
      field_combination_valid: (
        (status === 'success' && tripleExtracted === true) ||
        ((status === 'failed' || status === 'abandoned') && tripleExtracted === false)
      )
    });
  }

  /**
   * 평균 Confidence 계산
   * 
   * memory_relation 테이블에서 해당 Episodic Memory에서 생성된 모든 관계의 confidence 값을 수집하여 평균 계산
   * 
   * @param db 데이터베이스 연결
   * @param episodicMemoryId Episodic Memory ID
   * @returns 평균 Confidence (0.0~1.0), 관계가 없으면 null
   */
  private async calculateAverageConfidence(
    db: Database.Database,
    episodicMemoryId: string
  ): Promise<number | null> {
    try {
      // memory_relation에서 confidence 값 수집 (각 triple별로 저장됨)
      const relations = DatabaseUtils.all(db, `
        SELECT confidence FROM memory_relation
        WHERE source_id = ? AND relation_type = 'extracted_from'
      `, [episodicMemoryId]) as Array<{ confidence: number | null }>;

      if (relations.length === 0) {
        return null; // 관계가 없으면 null 반환
      }

      // confidence 값이 있는 관계만 필터링
      const confidenceValues = relations
        .map(rel => rel.confidence)
        .filter((c): c is number => c !== null && c !== undefined);

      if (confidenceValues.length === 0) {
        return null; // confidence 값이 없으면 null 반환
      }

      // 평균 계산
      const average = confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length;
      return Math.min(1.0, Math.max(0.0, average)); // 0.0~1.0 범위로 정규화
    } catch (error) {
      logger.warn('Failed to calculate average confidence', {
        episodic_memory_id: episodicMemoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

