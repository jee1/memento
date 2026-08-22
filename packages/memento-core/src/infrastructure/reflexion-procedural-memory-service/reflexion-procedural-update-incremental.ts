import type Database from 'better-sqlite3';

import { DatabaseUtils } from '../../shared/utils/database.js';
import type { ExtractedProceduralMemory } from '../../domains/memory/procedural/procedural-memory-extractor.js';
import { logger } from '../../shared/utils/logger.js';

export function mergeProceduralSteps(
  existingStepsJson: string | null | undefined,
  newStepsJson: string
): string {
  if (!existingStepsJson) {
    return newStepsJson;
  }

  try {
    const existingSteps = JSON.parse(existingStepsJson) as string[];
    const newSteps = JSON.parse(newStepsJson) as string[];
    const merged = [...existingSteps];
    for (const step of newSteps) {
      if (!merged.some(s => s.toLowerCase() === step.toLowerCase())) {
        merged.push(step);
      }
    }
    return JSON.stringify(merged);
  } catch (error) {
    logger.warn('steps 병합 실패, 새 steps 사용', {
      error: error instanceof Error ? error.message : String(error)
    });
    return newStepsJson;
  }
}

export function updateProceduralMemoryIncremental(
  db: Database.Database,
  memoryId: string,
  extracted: ExtractedProceduralMemory
): void {
  const existingRecord = DatabaseUtils.get(
    db,
    `SELECT steps FROM memory_item WHERE id = ?`,
    [memoryId]
  ) as { steps: string | null } | undefined;

  const shouldUpdateSteps = Boolean(extracted.steps);
  const mergedSteps = extracted.steps
    ? mergeProceduralSteps(existingRecord?.steps, extracted.steps)
    : null;

  if (shouldUpdateSteps) {
    DatabaseUtils.run(
      db,
      `UPDATE memory_item 
         SET workflow_name = COALESCE(?, workflow_name), 
             skill_name = COALESCE(?, skill_name), 
             trigger_conditions = COALESCE(?, trigger_conditions), 
             steps = ?,
             task_goal = COALESCE(?, task_goal)
         WHERE id = ?`,
      [
        extracted.workflow_name || null,
        extracted.skill_name || null,
        extracted.trigger_conditions || null,
        mergedSteps,
        extracted.task_goal || null,
        memoryId
      ]
    );
  } else {
    DatabaseUtils.run(
      db,
      `UPDATE memory_item 
         SET workflow_name = COALESCE(?, workflow_name), 
             skill_name = COALESCE(?, skill_name), 
             trigger_conditions = COALESCE(?, trigger_conditions), 
             task_goal = COALESCE(?, task_goal)
         WHERE id = ?`,
      [
        extracted.workflow_name || null,
        extracted.skill_name || null,
        extracted.trigger_conditions || null,
        extracted.task_goal || null,
        memoryId
      ]
    );
  }

  logger.info('Procedural Memory 업데이트됨 (incremental 모드)', {
    memory_id: memoryId,
    workflow_name: extracted.workflow_name,
    skill_name: extracted.skill_name
  });
}
