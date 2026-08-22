import type Database from 'better-sqlite3';

import { getNextVersionNumber } from '../../domains/memory/procedural/procedural-versioning.js';
import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import type { ExtractedProceduralMemory } from '../../domains/memory/procedural/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../../domains/memory/procedural/procedural-memory-extractor.types.js';
import { logger } from '../../shared/utils/logger.js';

export async function createProceduralMemory(
  db: Database.Database,
  extracted: ExtractedProceduralMemory,
  reflectionNote: ReflectionNotes | Record<string, unknown>,
  event: FailureEvent,
  existingMemoryIdForVersion?: string
): Promise<string | null> {
  try {
    const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const content = extracted.task_goal || `Reflexion: ${event.tool_name} 실패 기록`;
    const reflectionNotesStr = JSON.stringify(reflectionNote);

    let version: number;
    let versionSeriesId: string;
    if (existingMemoryIdForVersion) {
      const existing = DatabaseUtils.get(
        db,
        `SELECT version_series_id FROM memory_item WHERE id = ? AND type = 'procedural'`,
        [existingMemoryIdForVersion]
      ) as { version_series_id: string | null } | undefined;
      versionSeriesId = existing?.version_series_id ?? existingMemoryIdForVersion;
      version = getNextVersionNumber(db, versionSeriesId);
    } else {
      version = 1;
      versionSeriesId = memoryId;
    }

    DatabaseUtils.run(
      db,
      `INSERT INTO memory_item (
          id, type, content, workflow_name, skill_name, trigger_conditions, 
          steps, task_goal, reflection_notes, importance, privacy_scope, created_at,
          version, version_series_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memoryId,
        'procedural',
        content,
        extracted.workflow_name || null,
        extracted.skill_name || null,
        extracted.trigger_conditions || null,
        extracted.steps || null,
        extracted.task_goal || null,
        reflectionNotesStr,
        0.7,
        'private',
        new Date().toISOString(),
        version,
        versionSeriesId
      ]
    );

    logger.info('새 Procedural Memory 생성됨', {
      memory_id: memoryId,
      workflow_name: extracted.workflow_name,
      skill_name: extracted.skill_name
    });

    return memoryId;
  } catch (error) {
    logger.error('Procedural Memory 생성 실패', {
      error: error instanceof Error ? error.message : String(error),
      workflow_name: extracted.workflow_name,
      skill_name: extracted.skill_name
    });
    return null;
  }
}
