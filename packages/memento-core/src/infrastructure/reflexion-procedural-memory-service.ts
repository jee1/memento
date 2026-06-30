import Database from 'better-sqlite3';

import { LlmProceduralExtractor } from '../domains/memory/services/procedural-llm-extractor.js';
import { getNextVersionNumber } from '../domains/memory/services/procedural-versioning.js';
import type { FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { mementoConfig } from '../shared/config/index.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import {
  determineMergeStrategy,
  extractProceduralMemory,
  type ExtractedProceduralMemory
} from '../shared/utils/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../shared/utils/procedural-memory-extractor.types.js';
import { toDbRelationType } from '../shared/utils/relation-type-converter.js';
import { logger } from '../shared/utils/logger.js';

export class ReflexionProceduralMemoryService {
  constructor(private readonly db: Database.Database) {}

  /**
   * reflection_notes를 procedural memory로 자동 변환
   *
   * 변환 전략:
   * 1. reflection_notes에서 workflow_name, skill_name, steps, trigger_conditions 추출
   * 2. 기존 procedural memory와 유사도 계산
   * 3. 유사도 기반 병합 전략 결정 (replace, incremental, versioned)
   * 4. 결정된 전략에 따라 메모리 업데이트 또는 생성
   */
  async convert(
    reflectionNote: ReflectionNotes | Record<string, unknown>,
    event: FailureEvent
  ): Promise<void> {
    try {
      let extracted: ExtractedProceduralMemory;
      if (mementoConfig.proceduralExtractionStrategy === 'llm_first') {
        const llmExtractor = new LlmProceduralExtractor();
        const llmResult = await llmExtractor.extract(reflectionNote, event);
        if (llmResult && (llmResult.workflow_name || llmResult.skill_name)) {
          extracted = llmResult;
        } else {
          extracted = extractProceduralMemory(reflectionNote, event);
        }
      } else {
        extracted = extractProceduralMemory(reflectionNote, event);
      }

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
        await this.createProceduralMemory(extracted, reflectionNote, event);
      }
    } catch (error) {
      logger.error('Procedural Memory 변환 실패', {
        error: error instanceof Error ? error.message : String(error),
        event_id: event.id
      });
      // 변환 실패는 전체 프로세스를 중단하지 않음 (기존 reflection_notes는 이미 저장됨)
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
        DatabaseUtils.run(
          this.db,
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
      } else if (updateMode === 'incremental') {
        const existingRecord = DatabaseUtils.get(
          this.db,
          `SELECT steps FROM memory_item WHERE id = ?`,
          [memoryId]
        ) as { steps: string | null } | undefined;

        let mergedSteps: string | null = null;
        let shouldUpdateSteps = false;

        if (extracted.steps) {
          shouldUpdateSteps = true;
          if (existingRecord?.steps) {
            try {
              const existingSteps = JSON.parse(existingRecord.steps) as string[];
              const newSteps = JSON.parse(extracted.steps) as string[];
              const merged = [...existingSteps];
              for (const step of newSteps) {
                if (!merged.some(s => s.toLowerCase() === step.toLowerCase())) {
                  merged.push(step);
                }
              }
              mergedSteps = JSON.stringify(merged);
            } catch (error) {
              logger.warn('steps 병합 실패, 새 steps 사용', {
                error: error instanceof Error ? error.message : String(error)
              });
              mergedSteps = extracted.steps;
            }
          } else {
            mergedSteps = extracted.steps;
          }
        }

        DatabaseUtils.run(
          this.db,
          `UPDATE memory_item 
           SET workflow_name = COALESCE(?, workflow_name), 
               skill_name = COALESCE(?, skill_name), 
               trigger_conditions = COALESCE(?, trigger_conditions), 
               ${shouldUpdateSteps ? 'steps = ?,' : ''}
               task_goal = COALESCE(?, task_goal)
           WHERE id = ?`,
          shouldUpdateSteps
            ? [
                extracted.workflow_name || null,
                extracted.skill_name || null,
                extracted.trigger_conditions || null,
                mergedSteps,
                extracted.task_goal || null,
                memoryId
              ]
            : [
                extracted.workflow_name || null,
                extracted.skill_name || null,
                extracted.trigger_conditions || null,
                extracted.task_goal || null,
                memoryId
              ]
        );
        logger.info('Procedural Memory 업데이트됨 (incremental 모드)', {
          memory_id: memoryId,
          workflow_name: extracted.workflow_name,
          skill_name: extracted.skill_name
        });
      } else {
        const newMemoryId = await this.createProceduralMemory(
          extracted,
          reflectionNote,
          event,
          memoryId
        );

        if (newMemoryId) {
          const versionOfType = toDbRelationType('VERSION_OF');
          if (versionOfType) {
            DatabaseUtils.run(
              this.db,
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
        }
      }
    } catch (error) {
      logger.error('Procedural Memory 업데이트 실패', {
        error: error instanceof Error ? error.message : String(error),
        memory_id: memoryId,
        update_mode: updateMode
      });
      throw error;
    }
  }

  private async createProceduralMemory(
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
          this.db,
          `SELECT version_series_id FROM memory_item WHERE id = ? AND type = 'procedural'`,
          [existingMemoryIdForVersion]
        ) as { version_series_id: string | null } | undefined;
        versionSeriesId = existing?.version_series_id ?? existingMemoryIdForVersion;
        version = getNextVersionNumber(this.db, versionSeriesId);
      } else {
        version = 1;
        versionSeriesId = memoryId;
      }

      DatabaseUtils.run(
        this.db,
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
}
