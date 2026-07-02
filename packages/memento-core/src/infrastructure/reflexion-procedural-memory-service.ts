import Database from 'better-sqlite3';

import { determineMergeStrategy, type ExtractedProceduralMemory } from '../shared/utils/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../shared/utils/procedural-memory-extractor.types.js';
import type { FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { logger } from '../shared/utils/logger.js';
import { createProceduralMemory } from './reflexion-procedural-memory-service/reflexion-procedural-create.js';
import { resolveExtractedProceduralMemory } from './reflexion-procedural-memory-service/reflexion-procedural-extraction.js';
import { updateProceduralMemoryIncremental } from './reflexion-procedural-memory-service/reflexion-procedural-update-incremental.js';
import { updateProceduralMemoryReplace } from './reflexion-procedural-memory-service/reflexion-procedural-update-replace.js';
import { updateProceduralMemoryVersioned } from './reflexion-procedural-memory-service/reflexion-procedural-update-versioned.js';

export class ReflexionProceduralMemoryService {
  constructor(private readonly db: Database.Database) {}

  /**
   * reflection_notes를 procedural memory로 자동 변환
   */
  async convert(
    reflectionNote: ReflectionNotes | Record<string, unknown>,
    event: FailureEvent
  ): Promise<void> {
    try {
      const extracted = await resolveExtractedProceduralMemory(reflectionNote, event);

      if (!extracted.workflow_name && !extracted.skill_name) {
        logger.debug('Procedural Memory 변환 스킵: workflow_name과 skill_name이 모두 없음', {
          event_id: event.id
        });
        return;
      }

      const mergeStrategy = await determineMergeStrategy(this.db, extracted);

      if (mergeStrategy.shouldMerge && mergeStrategy.existingMemoryId) {
        await this.updateProceduralMemory(
          mergeStrategy.existingMemoryId,
          extracted,
          mergeStrategy.updateMode,
          reflectionNote,
          event
        );
      } else {
        await createProceduralMemory(this.db, extracted, reflectionNote, event);
      }
    } catch (error) {
      logger.error('Procedural Memory 변환 실패', {
        error: error instanceof Error ? error.message : String(error),
        event_id: event.id
      });
    }
  }

  async updateProceduralMemory(
    memoryId: string,
    extracted: ExtractedProceduralMemory,
    updateMode: 'replace' | 'incremental' | 'versioned',
    reflectionNote: ReflectionNotes | Record<string, unknown>,
    event: FailureEvent
  ): Promise<void> {
    try {
      if (updateMode === 'replace') {
        updateProceduralMemoryReplace(this.db, memoryId, extracted);
        return;
      }

      if (updateMode === 'incremental') {
        updateProceduralMemoryIncremental(this.db, memoryId, extracted);
        return;
      }

      await updateProceduralMemoryVersioned(
        this.db,
        memoryId,
        extracted,
        reflectionNote,
        event
      );
    } catch (error) {
      logger.error('Procedural Memory 업데이트 실패', {
        error: error instanceof Error ? error.message : String(error),
        memory_id: memoryId,
        update_mode: updateMode
      });
      throw error;
    }
  }
}
