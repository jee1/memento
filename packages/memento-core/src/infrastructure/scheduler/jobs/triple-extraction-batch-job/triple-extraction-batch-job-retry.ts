import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import type {
  ResolvedTripleExtractionBatchJobConfig,
  TripleExtractionTargetMemory
} from './triple-extraction-batch-job.types.js';

/**
 * 재시도 횟수 조회
 */
export function getTripleExtractionRetryCount(memory: {
  id: string;
  triple_extraction_metadata: string | null;
}): number {
  if (!memory.triple_extraction_metadata) {
    return 0;
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
 * 재시도 정책 확인
 */
export function shouldRetryTripleExtraction(
  memory: {
    id: string;
    triple_extraction_metadata: string | null;
  },
  config: ResolvedTripleExtractionBatchJobConfig,
  now: Date = new Date()
): boolean {
  const retryCount = getTripleExtractionRetryCount(memory);
  if (retryCount >= config.maxRetries) {
    return false;
  }

  if (!memory.triple_extraction_metadata) {
    return true;
  }

  try {
    const metadata = JSON.parse(memory.triple_extraction_metadata);
    const lastAttempt = metadata.last_attempt;

    if (!lastAttempt) {
      return true;
    }

    const lastAttemptDate = new Date(lastAttempt);
    const daysSinceLastAttempt = Math.floor(
      (now.getTime() - lastAttemptDate.getTime()) / (24 * 60 * 60 * 1000)
    );

    const backoffDays = config.retryBackoffDays[retryCount] ??
      config.retryBackoffDays[config.retryBackoffDays.length - 1] ?? 1;

    return daysSinceLastAttempt >= backoffDays;
  } catch (error) {
    logger.warn('Failed to parse triple_extraction_metadata for retry check', {
      memory_id: memory.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
  }
}

/**
 * 배치 작업 대상 조회
 */
export async function getTripleExtractionTargetMemories(
  db: Database.Database,
  limit: number,
  config: ResolvedTripleExtractionBatchJobConfig
): Promise<TripleExtractionTargetMemory[]> {
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
    `, [limit]) as TripleExtractionTargetMemory[];

  const now = new Date();
  return memories.filter(memory => {
    if (memory.triple_extracted_status === null || memory.triple_extracted_status === '') {
      return true;
    }

    if (memory.triple_extracted_status === 'failed') {
      return shouldRetryTripleExtraction(memory, config, now);
    }

    return true;
  });
}
