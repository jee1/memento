import Database from 'better-sqlite3';

import { determineMergeStrategy, extractProceduralMemory, type ExtractedProceduralMemory } from '../domains/memory/procedural/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../domains/memory/procedural/procedural-memory-extractor.types.js';
import type { FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { logger } from '../shared/utils/logger.js';
import { MemoryEmbeddingService } from '../domains/embedding/services/memory-embedding-service.js';
import { createProceduralMemory, createUnverifiedReflexionMemory } from './reflexion-procedural-memory-service/reflexion-procedural-create.js';
import { mementoConfig } from '../shared/config/index.js';
import { resolveExtractedProceduralMemory } from './reflexion-procedural-memory-service/reflexion-procedural-extraction.js';
import { updateProceduralMemoryIncremental } from './reflexion-procedural-memory-service/reflexion-procedural-update-incremental.js';
import { updateProceduralMemoryReplace } from './reflexion-procedural-memory-service/reflexion-procedural-update-replace.js';
import { updateProceduralMemoryVersioned } from './reflexion-procedural-memory-service/reflexion-procedural-update-versioned.js';

export class ReflexionProceduralMemoryService {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService = new MemoryEmbeddingService()
  ) {}

  /**
   * reflection_notes를 변환한다. 관찰 분리 설정에서는 후보만 저장한다.
   */
  async convert(
    reflectionNote: ReflectionNotes | Record<string, unknown>,
    event: FailureEvent
  ): Promise<void> {
    try {
      const observationOnly = mementoConfig.reflexionObservationOnly;
      const extracted = observationOnly
        ? extractProceduralMemory(reflectionNote, event)
        : await resolveExtractedProceduralMemory(reflectionNote, event);

      if (!extracted.workflow_name && !extracted.skill_name) {
        logger.debug('Procedural Memory 변환 스킵: workflow_name과 skill_name이 모두 없음', {
          event_id: event.id
        });
        return;
      }

      if (observationOnly) {
        await createUnverifiedReflexionMemory(this.db, reflectionNote, event, 'unverified_candidate', extracted, this.embeddingService);
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
        await createProceduralMemory(this.db, extracted, reflectionNote, event, undefined, this.embeddingService);
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
      if (mementoConfig.reflexionObservationOnly) {
        await createUnverifiedReflexionMemory(this.db, reflectionNote, event, 'unverified_candidate', extracted, this.embeddingService);
        return;
      }
      if (updateMode === 'replace') {
        updateProceduralMemoryReplace(this.db, memoryId, extracted);
        await this.refreshEmbedding(memoryId);
        return;
      }

      if (updateMode === 'incremental') {
        updateProceduralMemoryIncremental(this.db, memoryId, extracted);
        await this.refreshEmbedding(memoryId);
        return;
      }

      await updateProceduralMemoryVersioned(
        this.db,
        memoryId,
        extracted,
        reflectionNote,
        event,
        this.embeddingService
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

  private async refreshEmbedding(memoryId: string): Promise<void> {
    const memory = this.db.prepare(
      "SELECT content FROM memory_item WHERE id = ? AND type = 'procedural' AND COALESCE(is_deleted, 0) = 0"
    ).get(memoryId) as { content: string } | undefined;
    if (!memory) return;

    const embedding = await this.embeddingService.createAndStoreEmbedding(
      this.db,
      memoryId,
      memory.content,
      'procedural'
    );
    if (!embedding) {
      logger.warn('Procedural Memory embedding pending reconciliation', { memory_id: memoryId });
    }
  }
}
