import type { BatchJobResult } from '../../batch-scheduler/batch-scheduler-types.js';

export function getErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}

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

export type ResolvedTripleExtractionBatchJobConfig = Required<TripleExtractionBatchJobConfig>;

/**
 * 재시도 자격 판정 결과
 * - 자격 있음: 현재까지의 (검증된) 재시도 횟수
 * - 자격 없음: 제외 사유 (metadata는 손상 시에도 절대 보정하지 않는다)
 */
export type TripleExtractionRetryEligibility =
  | { eligible: true; retryCount: number }
  | { eligible: false; reason: string };

/**
 * Triple 추출 배치 작업 결과
 */
export interface TripleExtractionBatchResult extends BatchJobResult {
  details: {
    processed: number;
    success: number;
    failed: number;
    skipped: number;
    semanticMemoriesCreated: number;
    semanticMemoriesUpdated: number;
    retryCounts: Map<string, number>;
  };
  /**
   * 타임아웃 발생 여부
   */
  timeoutOccurred?: boolean;
}

export interface TripleExtractionTargetMemory {
  id: string;
  content: string;
  importance: number | null;
  triple_extracted: number | null;
  triple_extracted_status: string | null;
  triple_extraction_metadata: string | null;
}
