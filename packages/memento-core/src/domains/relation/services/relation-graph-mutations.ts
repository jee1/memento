/**
 * 관계 그래프 변경 (추가/삭제/신뢰도 갱신/배치)
 */

import Database from 'better-sqlite3';
import { CONFIDENCE } from '../../../shared/constants/relation-constants.js';
import type {
  AddRelationOptions,
  RelationMetadata
} from '../../../shared/types/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  isExistingRelationRow,
  isMetadataRow,
  type ExistingRelationRow
} from '../../../shared/utils/type-guards.js';
import type { RelationGraphCache } from './relation-graph-cache.js';
import type { RelationGraphCycleDetector } from './relation-graph-cycle-detector.js';
import { CyclicRelationError, DuplicateRelationError } from './relation-errors.js';

export class RelationGraphMutations {
  constructor(
    private db: Database.Database,
    private cache: RelationGraphCache,
    private cycleDetector: RelationGraphCycleDetector
  ) {}

  /**
   * 관계 추가
   */
  async addRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    options?: AddRelationOptions
  ): Promise<number> {
    this.validateRelationInput(sourceId, targetId);

    const confidence = options?.confidence ?? CONFIDENCE.DEFAULT;
    const updateOnConflict = options?.updateOnConflict ?? false;
    const allowCyclic = options?.allowCyclic ?? false;

    return await DatabaseUtils.runTransaction(this.db, async () => {
      if (!allowCyclic) {
        await this.checkForCyclicRelation(sourceId, targetId, relationType);
      }

      const metadata = this.prepareMetadata(options, allowCyclic);
      const metadataJson = JSON.stringify(metadata);

      try {
        return await this.addRelationInternal(
          sourceId,
          targetId,
          relationType,
          confidence,
          metadata,
          metadataJson,
          updateOnConflict,
          allowCyclic
        );
      } catch (error) {
        return await this.handleRelationAddError(
          error,
          sourceId,
          targetId,
          relationType,
          confidence,
          metadata,
          updateOnConflict
        );
      }
    });
  }

  /**
   * 관계 삭제
   */
  async removeRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<boolean> {
    const result = DatabaseUtils.run(this.db, `
      DELETE FROM memory_relation
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [sourceId, targetId, relationType]);

    if (result.changes > 0) {
      this.cache.invalidate(sourceId);
      this.cache.invalidate(targetId);
      return true;
    }

    return false;
  }

  /**
   * 신뢰도 갱신
   */
  async updateConfidence(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    newConfidence: number,
    reason?: string
  ): Promise<boolean> {
    const queryResult = DatabaseUtils.get(this.db, `
      SELECT id, confidence, metadata
      FROM memory_relation
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [sourceId, targetId, relationType]);

    if (!queryResult) {
      return false;
    }

    if (!isExistingRelationRow(queryResult)) {
      logger.warn('신뢰도 갱신: 타입 검증 실패', {
        sourceId,
        targetId,
        relationType,
        resultType: typeof queryResult
      });
      return false;
    }

    const existing = queryResult;
    const oldConfidence = existing.confidence;
    const oldMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};

    const refinementHistory = oldMetadata.refinement_history || [];
    refinementHistory.push({
      timestamp: new Date().toISOString(),
      old_confidence: oldConfidence,
      new_confidence: newConfidence,
      reason: reason || '신뢰도 갱신'
    });

    const updatedMetadata: RelationMetadata = {
      ...oldMetadata,
      refinement_history: refinementHistory
    };

    const updateResult = DatabaseUtils.run(this.db, `
      UPDATE memory_relation
      SET confidence = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newConfidence, JSON.stringify(updatedMetadata), existing.id]);

    if (updateResult.changes > 0) {
      this.cache.invalidate(sourceId);
      this.cache.invalidate(targetId);
      return true;
    }

    return false;
  }

  /**
   * 배치 관계 추가
   */
  async addRelationsBatch(
    relations: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      confidence?: number;
      metadata?: RelationMetadata;
    }>
  ): Promise<{
    insertedIds: number[];
    failed: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      error: string;
    }>;
    total: number;
    success: number;
    failedCount: number;
  }> {
    const insertedIds: number[] = [];
    const failed: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      error: string;
    }> = [];

    await DatabaseUtils.runTransaction(this.db, async () => {
      for (const relation of relations) {
        try {
          const id = await this.addRelation(
            relation.source_id,
            relation.target_id,
            relation.relation_type,
            {
              confidence: relation.confidence,
              metadata: relation.metadata,
              updateOnConflict: true,
              allowCyclic: false
            }
          );
          insertedIds.push(id);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          failed.push({
            source_id: relation.source_id,
            target_id: relation.target_id,
            relation_type: relation.relation_type,
            error: errorMessage
          });

          logger.warn('관계 추가 실패', {
            source_id: relation.source_id,
            target_id: relation.target_id,
            relation_type: relation.relation_type,
            error: errorMessage
          });
        }
      }
      return { insertedIds, failed };
    });

    return {
      insertedIds,
      failed,
      total: relations.length,
      success: insertedIds.length,
      failedCount: failed.length
    };
  }

  private async addRelationInternal(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadata: RelationMetadata,
    metadataJson: string,
    updateOnConflict: boolean,
    allowCyclic: boolean
  ): Promise<number> {
    const existing = this.findExistingRelation(sourceId, targetId, relationType);
    if (existing) {
      return await this.handleExistingRelation(
        existing,
        sourceId,
        targetId,
        relationType,
        confidence,
        metadata,
        updateOnConflict
      );
    }

    const relationId = await this.insertNewRelation(
      sourceId,
      targetId,
      relationType,
      confidence,
      metadataJson,
      allowCyclic
    );

    this.cache.invalidate(sourceId);
    this.cache.invalidate(targetId);

    return relationId;
  }

  private async handleRelationAddError(
    error: unknown,
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadata: RelationMetadata,
    updateOnConflict: boolean
  ): Promise<number> {
    const isUniqueConstraintError =
      error instanceof Error &&
      (error.message.includes('UNIQUE constraint') ||
       error.message.includes('UNIQUE constraint failed') ||
       (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE');

    if (isUniqueConstraintError) {
      const existing = this.findExistingRelation(sourceId, targetId, relationType);
      if (existing && updateOnConflict) {
        return await this.handleExistingRelation(
          existing,
          sourceId,
          targetId,
          relationType,
          confidence,
          metadata,
          updateOnConflict
        );
      }
      throw new DuplicateRelationError(
        sourceId,
        targetId,
        relationType,
        `이미 존재하는 관계입니다: ${sourceId} -> ${targetId} (${relationType}). 동시성 문제로 인해 관계가 이미 추가되었습니다.`
      );
    }
    throw error;
  }

  private validateRelationInput(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      throw new Error('자기 자신에 대한 관계는 생성할 수 없습니다.');
    }
  }

  private async checkForCyclicRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<void> {
    const isCyclic = await this.cycleDetector.detectCycleInternal(sourceId, targetId, relationType);
    if (isCyclic) {
      throw new CyclicRelationError(sourceId, targetId, relationType);
    }
  }

  private prepareMetadata(
    options?: AddRelationOptions,
    allowCyclic?: boolean
  ): RelationMetadata {
    return {
      method: options?.metadata?.method,
      extracted_at: options?.metadata?.extracted_at || new Date().toISOString(),
      cyclic: allowCyclic ? true : undefined,
      evidence: options?.metadata?.evidence,
      ...options?.metadata
    };
  }

  private findExistingRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): ExistingRelationRow | null {
    const result = DatabaseUtils.get(this.db, `
      SELECT id, confidence, metadata
      FROM memory_relation
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [sourceId, targetId, relationType]);

    if (result === null || result === undefined) {
      return null;
    }

    if (isExistingRelationRow(result)) {
      return result;
    }

    logger.warn('기존 관계 조회 결과 타입 검증 실패', {
      sourceId,
      targetId,
      relationType,
      resultType: typeof result
    });
    return null;
  }

  private async handleExistingRelation(
    existing: { id: number; confidence: number; metadata: string | null },
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadata: RelationMetadata,
    updateOnConflict: boolean
  ): Promise<number> {
    if (!updateOnConflict) {
      throw new DuplicateRelationError(sourceId, targetId, relationType);
    }

    const oldConfidence = existing.confidence;
    const oldMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};

    const refinementHistory = oldMetadata.refinement_history || [];
    refinementHistory.push({
      timestamp: new Date().toISOString(),
      old_confidence: oldConfidence,
      new_confidence: confidence,
      reason: '관계 추가 시 업데이트'
    });

    const updatedMetadata: RelationMetadata = {
      ...oldMetadata,
      ...metadata,
      refinement_history: refinementHistory
    };

    DatabaseUtils.run(this.db, `
      UPDATE memory_relation
      SET confidence = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [confidence, JSON.stringify(updatedMetadata), existing.id]);

    this.cache.invalidate(sourceId);
    this.cache.invalidate(targetId);

    return existing.id;
  }

  private async insertNewRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadataJson: string,
    allowCyclic: boolean
  ): Promise<number> {
    const result = DatabaseUtils.run(this.db, `
      INSERT INTO memory_relation (
        source_id, target_id, relation_type, confidence, metadata
      )
      VALUES (?, ?, ?, ?, ?)
    `, [sourceId, targetId, relationType, confidence, metadataJson]);

    const relationId = result.lastInsertRowid as number;

    if (allowCyclic) {
      await this.updateCyclicFlag(relationId);
    }

    return relationId;
  }

  private async updateCyclicFlag(relationId: number): Promise<void> {
    const result = DatabaseUtils.get(this.db, `
      SELECT metadata FROM memory_relation WHERE id = ?
    `, [relationId]);

    if (!result) {
      logger.warn('순환 참조 플래그 업데이트 실패: 관계를 찾을 수 없습니다', { relationId });
      return;
    }

    if (!isMetadataRow(result)) {
      logger.warn('순환 참조 플래그 업데이트 실패: 타입 검증 실패', {
        relationId,
        resultType: typeof result
      });
      return;
    }

    const existing = result;

    let updatedMetadata: RelationMetadata;
    if (existing.metadata) {
      updatedMetadata = JSON.parse(existing.metadata);
    } else {
      updatedMetadata = {};
    }

    updatedMetadata.cyclic = true;

    DatabaseUtils.run(this.db, `
      UPDATE memory_relation
      SET metadata = ?
      WHERE id = ?
    `, [JSON.stringify(updatedMetadata), relationId]);
  }
}
