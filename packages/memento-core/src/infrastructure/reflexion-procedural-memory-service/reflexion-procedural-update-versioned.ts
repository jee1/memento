import type Database from 'better-sqlite3';

import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import type { ExtractedProceduralMemory } from '../../domains/memory/procedural/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../../domains/memory/procedural/procedural-memory-extractor.types.js';
import { toDbRelationType } from '../../shared/utils/relation-type-converter.js';
import { logger } from '../../shared/utils/logger.js';
import { createProceduralMemory } from './reflexion-procedural-create.js';

export async function updateProceduralMemoryVersioned(
  db: Database.Database,
  memoryId: string,
  extracted: ExtractedProceduralMemory,
  reflectionNote: ReflectionNotes | Record<string, unknown>,
  event: FailureEvent
): Promise<void> {
  const newMemoryId = await createProceduralMemory(
    db,
    extracted,
    reflectionNote,
    event,
    memoryId
  );

  if (!newMemoryId) {
    return;
  }

  const versionOfType = toDbRelationType('VERSION_OF');
  if (!versionOfType) {
    return;
  }

  DatabaseUtils.run(
    db,
    `INSERT INTO memory_link (source_id, target_id, relation_type, created_at)
       VALUES (?, ?, ?, ?)`,
    [
      newMemoryId,
      memoryId,
      versionOfType,
      new Date().toISOString()
    ]
  );
  logger.info('Procedural Memory 버전 생성됨 (versioned 모드)', {
    new_memory_id: newMemoryId,
    existing_memory_id: memoryId,
    workflow_name: extracted.workflow_name,
    skill_name: extracted.skill_name
  });
}
