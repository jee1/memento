/**
 * Semantic Memory 관계 타입 등록·episodic edge 생성
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import type { RelationGraphPort } from '../../relation/ports/relation-graph.port.js';
import { DuplicateRelationError } from '../../relation/services/relation-errors.js';
import type { EpisodicSourceSnapshot } from './semantic-memory-update-types.js';

type EpisodicRelationKind = 'extracted_from' | 'supported_by';

export class SemanticMemoryRelations {
  constructor(
    private db: Database.Database,
    private relationGraph: RelationGraphPort
  ) {}

  ensureRelationTypes(): void {
    const requiredApplicable = JSON.stringify(['episodic', 'semantic']);

    const hasValidApplicableTypes = (raw: string | null | undefined): boolean => {
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed)
          && parsed.includes('episodic')
          && parsed.includes('semantic');
      } catch {
        return false;
      }
    };

    const ensureType = (
      typeName: 'extracted_from' | 'supported_by',
      description: string
    ): void => {
      const row = DatabaseUtils.get(this.db, `
        SELECT type_name, applicable_types AS applicableTypes
        FROM relation_type_registry WHERE type_name = ?
      `, [typeName]) as { type_name: string; applicableTypes: string | null } | undefined;

      if (!row) {
        DatabaseUtils.run(this.db, `
          INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [typeName, 'Structural', description, requiredApplicable, 0.7, 1.1]);
        logger.debug(`SemanticMemoryUpdateService: ${typeName} 관계 타입 등록`);
        return;
      }

      // Live DBs may keep the row with applicable_types=[] after older seeds; heal in place
      // so validateRelationContract does not block all automatic semantic writes (#847).
      if (!hasValidApplicableTypes(row.applicableTypes)) {
        DatabaseUtils.run(this.db, `
          UPDATE relation_type_registry
          SET applicable_types = ?
          WHERE type_name = ?
        `, [requiredApplicable, typeName]);
        logger.debug(`SemanticMemoryUpdateService: ${typeName} applicable_types 복구`);
      }
    };

    try {
      ensureType('extracted_from', '추출 관계: Semantic Memory가 Episodic Memory에서 추출됨');
      ensureType('supported_by', '지지 관계: Episodic Memory가 Semantic Memory에 의해 지지됨');
    } catch (error) {
      logger.warn('SemanticMemoryUpdateService: relation_type_registry 등록 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async validateRelationDirection(
    sourceId: string,
    targetId: string,
    relationType: EpisodicRelationKind
  ): Promise<void> {
    const sourceMemory = DatabaseUtils.get(this.db, `
      SELECT id, type FROM memory_item WHERE id = ?
    `, [sourceId]) as { id: string; type: string } | undefined;

    const targetMemory = DatabaseUtils.get(this.db, `
      SELECT id, type FROM memory_item WHERE id = ?
    `, [targetId]) as { id: string; type: string } | undefined;

    if (!sourceMemory || !targetMemory) {
      throw new Error(`Memory를 찾을 수 없습니다: source=${sourceId}, target=${targetId}`);
    }

    if (relationType === 'extracted_from') {
      if (sourceMemory.type !== 'semantic' || targetMemory.type !== 'episodic') {
        throw new Error(
          `extracted_from 관계 방향 오류: source는 'semantic'이어야 하고 target은 'episodic'이어야 합니다. ` +
          `현재: source=${sourceMemory.type}, target=${targetMemory.type}`
        );
      }
    } else if (relationType === 'supported_by') {
      if (sourceMemory.type !== 'episodic' || targetMemory.type !== 'semantic') {
        throw new Error(
          `supported_by 관계 방향 오류: source는 'episodic'이어야 하고 target은 'semantic'이어야 합니다. ` +
          `현재: source=${sourceMemory.type}, target=${targetMemory.type}`
        );
      }
    }
  }

  validateRelationContract(source: EpisodicSourceSnapshot): void {
    if (source.type !== 'episodic') {
      throw new Error('관계 방향 오류: source는 episodic이어야 합니다.');
    }

    const rows = DatabaseUtils.all(this.db, `
      SELECT type_name, applicable_types
      FROM relation_type_registry
      WHERE type_name IN ('extracted_from', 'supported_by')
    `) as Array<{ type_name: string; applicable_types: string | null }>;

    for (const relationType of ['extracted_from', 'supported_by'] as const) {
      const row = rows.find((candidate) => candidate.type_name === relationType);
      let applicableTypes: unknown;
      try {
        applicableTypes = row?.applicable_types ? JSON.parse(row.applicable_types) : null;
      } catch {
        applicableTypes = null;
      }
      if (
        !Array.isArray(applicableTypes) ||
        !applicableTypes.includes('episodic') ||
        !applicableTypes.includes('semantic')
      ) {
        throw new Error(`${relationType} 관계 타입 계약 오류`);
      }
    }
  }

  async createEpisodicRelation(
    relationType: EpisodicRelationKind,
    sourceId: string,
    targetId: string,
    confidence: number
  ): Promise<void> {
    await this.validateRelationDirection(sourceId, targetId, relationType);
    try {
      await this.relationGraph.addRelation(sourceId, targetId, relationType, {
        confidence,
        metadata: { method: 'llm' },
        updateOnConflict: false,
        allowCyclic: true
      });
    } catch (error) {
      if (error instanceof DuplicateRelationError || this.isUniqueConstraintError(error)) {
        try {
          logger.debug('SemanticMemoryUpdateService: 관계 중복 (무시)', { relationType });
        } catch {
          // Duplicate settlement must not depend on logging.
        }
        return;
      }
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error &&
      (error.message.includes('UNIQUE constraint') ||
       error.message.includes('UNIQUE constraint failed') ||
       (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE');
  }
}
