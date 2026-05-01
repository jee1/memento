import Database from 'better-sqlite3';
import { mementoConfig } from '../shared/config/index.js';
import { WriteCoalescingManager, type CoalescedWrite } from '../shared/utils/write-coalescing.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { logger } from '../shared/utils/logger.js';
import type { SqlParam } from '../shared/types/index.js';
import { ConsolidationScoreService } from '../infrastructure/consolidation-score-service.js';
import { MetaMemoryService } from '../domains/memory/services/meta-memory-service.js';

export function createWriteCoalescingMetaAndScore(db: Database.Database): {
  writeCoalescingManager: WriteCoalescingManager;
  consolidationScoreService: ConsolidationScoreService | undefined;
  metaMemoryService: MetaMemoryService;
} {
  let consolidationScoreService: ConsolidationScoreService | undefined;
  const writeCoalescingManager = new WriteCoalescingManager(
    1000,
    async (writes: CoalescedWrite[]) => {
      if (!db || writes.length === 0) return;
      const currentDb = db;
      try {
        await DatabaseUtils.runTransaction(currentDb, async () => {
          for (const write of writes) {
            const updates: string[] = [];
            const params: SqlParam[] = [];
            if (write.fields.recall_count !== undefined) {
              updates.push('recall_count = ?');
              params.push(write.fields.recall_count);
            }
            if (write.fields.last_accessed_at !== undefined) {
              updates.push('last_accessed_at = ?');
              params.push(write.fields.last_accessed_at);
            }
            if (mementoConfig.consolidationScoreEnabled) {
              if (write.fields.g_value !== undefined) {
                updates.push('g_value = ?');
                params.push(write.fields.g_value);
              }
              if (write.fields.consolidation_score !== undefined) {
                updates.push('consolidation_score = ?');
                params.push(write.fields.consolidation_score);
              }
            }
            if (updates.length > 0) {
              params.push(write.memoryId);
              DatabaseUtils.run(
                currentDb,
                `UPDATE memory_item SET ${updates.join(', ')} WHERE id = ?`,
                params
              );
            }
          }
        });
      } catch (error) {
        logger.error(`⚠️ Write coalescing flush 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  if (mementoConfig.consolidationScoreEnabled) {
    consolidationScoreService = new ConsolidationScoreService();
  }
  const metaMemoryService = new MetaMemoryService(db, writeCoalescingManager);
  logger.info('MetaMemoryService 초기화 완료');
  return { writeCoalescingManager, consolidationScoreService, metaMemoryService };
}
