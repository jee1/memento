/**
 * Semantic Memory 관계 타입 등록·episodic edge 생성
 */

import Database from 'better-sqlite3';
import type { ExtractionInfo, Triple } from '../../../../shared/types/triple-extraction.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { RelationGraphPort } from '../../../relation/ports/relation-graph.port.js';
import { DuplicateRelationError } from '../../../relation/services/relation-errors.js';

export class SemanticMemoryRelations {
  constructor(
    private db: Database.Database,
    private relationGraph: RelationGraphPort
  ) {}

  ensureRelationTypes(): void {
    try {
      const extractedFrom = DatabaseUtils.get(this.db, `
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `, ['extracted_from']) as { type_name: string } | undefined;

      if (!extractedFrom) {
        DatabaseUtils.run(this.db, `
          INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          'extracted_from',
          'Structural',
          '추출 관계: Semantic Memory가 Episodic Memory에서 추출됨',
          JSON.stringify(['episodic', 'semantic']),
          0.7,
          1.1
        ]);
        logger.debug('SemanticMemoryUpdateService: extracted_from 관계 타입 등록');
      }

      const supportedBy = DatabaseUtils.get(this.db, `
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `, ['supported_by']) as { type_name: string } | undefined;

      if (!supportedBy) {
        DatabaseUtils.run(this.db, `
          INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          'supported_by',
          'Structural',
          '지지 관계: Episodic Memory가 Semantic Memory에 의해 지지됨',
          JSON.stringify(['episodic', 'semantic']),
          0.7,
          1.1
        ]);
        logger.debug('SemanticMemoryUpdateService: supported_by 관계 타입 등록');
      }
    } catch (error) {
      logger.warn('SemanticMemoryUpdateService: relation_type_registry 등록 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async validateRelationDirection(
    sourceId: string,
    targetId: string,
    relationType: 'extracted_from' | 'supported_by'
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

  async createEpisodicEdge(
    episodicMemoryId: string,
    semanticMemoryId: string,
    triple: Triple,
    extractionInfo: ExtractionInfo,
    confidence: number
  ): Promise<void> {
    await this.validateRelationDirection(semanticMemoryId, episodicMemoryId, 'extracted_from');
    await this.validateRelationDirection(episodicMemoryId, semanticMemoryId, 'supported_by');

    const relationOptions = {
      confidence,
      metadata: {
        method: 'llm' as const,
        triple: {
          subject: triple.subject,
          predicate: triple.predicate,
          object: triple.object
        },
        failureReason: extractionInfo.failureReason,
        steps: extractionInfo.steps
      },
      updateOnConflict: true,
      allowCyclic: true
    };

    await this.tryCreateEpisodicRelation(
      semanticMemoryId,
      episodicMemoryId,
      'extracted_from',
      relationOptions,
      episodicMemoryId,
      semanticMemoryId,
      confidence
    );

    await this.tryCreateEpisodicRelation(
      episodicMemoryId,
      semanticMemoryId,
      'supported_by',
      relationOptions,
      episodicMemoryId,
      semanticMemoryId,
      confidence
    );
  }

  private async tryCreateEpisodicRelation(
    sourceId: string,
    targetId: string,
    relationType: 'extracted_from' | 'supported_by',
    options: {
      confidence: number;
      metadata: {
        method: 'llm';
        triple: { subject: string; predicate: string; object: string };
        failureReason?: string;
        steps?: ExtractionInfo['steps'];
      };
      updateOnConflict: boolean;
      allowCyclic: boolean;
    },
    episodicMemoryId: string,
    semanticMemoryId: string,
    confidence: number
  ): Promise<void> {
    try {
      await this.relationGraph.addRelation(sourceId, targetId, relationType, options);
    } catch (error) {
      if (error instanceof DuplicateRelationError || this.isUniqueConstraintError(error)) {
        logger.debug('SemanticMemoryUpdateService: 관계 중복 (무시)', {
          episodicMemoryId,
          semanticMemoryId,
          relationType
        });
        return;
      }

      logger.error('SemanticMemoryUpdateService: 관계 생성 실패', {
        error: error instanceof Error ? error.message : String(error),
        episodicMemoryId,
        semanticMemoryId,
        confidence,
        relationType
      });
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error &&
      (error.message.includes('UNIQUE constraint') ||
       error.message.includes('UNIQUE constraint failed') ||
       (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE');
  }
}
