import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import { getNextVersionNumber } from '../../domains/memory/procedural/procedural-versioning.js';
import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import type { ExtractedProceduralMemory } from '../../domains/memory/procedural/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../../domains/memory/procedural/procedural-memory-extractor.types.js';
import { logger } from '../../shared/utils/logger.js';
import { MemoryEmbeddingService } from '../../domains/embedding/services/memory-embedding-service.js';
import { enforceReflexionObservationPinnedCap } from '../reflexion-observation-pinned-cap.js';

export async function createUnverifiedReflexionMemory(
  db: Database.Database,
  reflectionNote: ReflectionNotes | Record<string, unknown>,
  event: FailureEvent,
  state: 'failure_observation' | 'unverified_candidate',
  extracted: ExtractedProceduralMemory,
  embeddingService?: MemoryEmbeddingService
): Promise<string> {
  const memoryId = `mem_${randomUUID()}`;
  const label = state === 'failure_observation' ? '실패 관찰: 검증된 절차 아님' : '미검증 절차 후보: 실행·채택 금지';
  const content = `[${label}] ${extracted.task_goal || event.tool_name}\n${event.error_message}`;
  const scope = event.scope;
  const origin = JSON.stringify({ tool: 'reflexion', reflexion: {
    state, event_id: event.id, scope: scope ?? null,
    environment: event.context?.environment ?? null,
    tool_version: event.context?.tool_version ?? null,
  } });
  enforceReflexionObservationPinnedCap(db, 1);
  // pin은 자동 통합의 importance 하향과 TTL 망각으로부터 원본·후보를 보호한다.
  DatabaseUtils.run(db, `INSERT INTO memory_item (
    id, type, content, task_goal, workflow_name, skill_name, steps, trigger_conditions,
    reflection_notes, importance, privacy_scope, pinned, source, origin_source,
    owner_id, project_id, process_id, session_id, created_at
  ) VALUES (?, 'episodic', ?, ?, ?, ?, ?, ?, ?, 0.7, 'private', 1, 'reflexion', ?, ?, ?, ?, ?, ?)`, [
    memoryId, content, extracted.task_goal || null, extracted.workflow_name || null,
    extracted.skill_name || null, extracted.steps || null, extracted.trigger_conditions || null,
    JSON.stringify(reflectionNote), origin, scope?.owner_id ?? null, scope?.project_id ?? null,
    scope?.process_id ?? null, scope?.session_id ?? null, new Date().toISOString(),
  ]);
  if (embeddingService) {
    const embedding = await embeddingService.createAndStoreEmbedding(db, memoryId, content, 'episodic');
    if (!embedding) logger.warn('Reflexion candidate embedding pending reconciliation', { memory_id: memoryId });
  }
  return memoryId;
}

export async function createProceduralMemory(
  db: Database.Database,
  extracted: ExtractedProceduralMemory,
  reflectionNote: ReflectionNotes | Record<string, unknown>,
  event: FailureEvent,
  existingMemoryIdForVersion?: string,
  embeddingService: MemoryEmbeddingService = new MemoryEmbeddingService()
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

    const embedding = await embeddingService.createAndStoreEmbedding(
      db,
      memoryId,
      content,
      'procedural'
    );
    if (!embedding) {
      logger.warn('Procedural Memory embedding pending reconciliation', { memory_id: memoryId });
    }

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
