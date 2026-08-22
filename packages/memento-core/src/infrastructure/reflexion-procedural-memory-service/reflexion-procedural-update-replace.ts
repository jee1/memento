import type Database from 'better-sqlite3';

import { DatabaseUtils } from '../../shared/utils/database.js';
import type { ExtractedProceduralMemory } from '../../domains/memory/procedural/procedural-memory-extractor.js';
import { logger } from '../../shared/utils/logger.js';

export function updateProceduralMemoryReplace(
  db: Database.Database,
  memoryId: string,
  extracted: ExtractedProceduralMemory
): void {
  DatabaseUtils.run(
    db,
    `UPDATE memory_item 
       SET workflow_name = COALESCE(?, workflow_name),
           skill_name = COALESCE(?, skill_name),
           trigger_conditions = COALESCE(?, trigger_conditions),
           steps = COALESCE(?, steps),
           task_goal = COALESCE(?, task_goal)
       WHERE id = ?`,
    [
      extracted.workflow_name || null,
      extracted.skill_name || null,
      extracted.trigger_conditions || null,
      extracted.steps || null,
      extracted.task_goal || null,
      memoryId
    ]
  );
  logger.info('Procedural Memory 업데이트됨 (replace 모드)', {
    memory_id: memoryId,
    workflow_name: extracted.workflow_name,
    skill_name: extracted.skill_name,
    note: 'undefined/null 필드는 기존 값 보존'
  });
}
