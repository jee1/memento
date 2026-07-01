import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * 메모리 상태 업데이트
 */
export async function updateTripleExtractionMemoryStatus(
  db: Database.Database,
  memoryId: string,
  status: 'success' | 'failed' | 'abandoned',
  metadata: Record<string, unknown>
): Promise<void> {
  const tripleExtracted = status === 'success' ? true : false;

  await DatabaseUtils.run(db, `
      UPDATE memory_item SET
        triple_extracted = ?,
        triple_extracted_status = ?,
        triple_extraction_metadata = ?
      WHERE id = ?
    `, [
    tripleExtracted ? 1 : 0,
    status,
    JSON.stringify(metadata),
    memoryId
  ]);

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
 */
export async function calculateTripleExtractionAverageConfidence(
  db: Database.Database,
  episodicMemoryId: string
): Promise<number | null> {
  try {
    const relations = DatabaseUtils.all(db, `
        SELECT confidence FROM memory_relation
        WHERE target_id = ? AND relation_type = 'extracted_from'
      `, [episodicMemoryId]) as Array<{ confidence: number | null }>;

    if (relations.length === 0) {
      return null;
    }

    const confidenceValues = relations
      .map(rel => rel.confidence)
      .filter((c): c is number => c !== null && c !== undefined);

    if (confidenceValues.length === 0) {
      return null;
    }

    const average = confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length;
    return Math.min(1.0, Math.max(0.0, average));
  } catch (error) {
    logger.warn('Failed to calculate average confidence', {
      episodic_memory_id: episodicMemoryId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
