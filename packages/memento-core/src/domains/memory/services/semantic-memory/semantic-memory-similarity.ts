/**
 * Semantic Memory 중복 검색·임베딩 유사도
 */

import Database from 'better-sqlite3';
import type { Triple } from '../../../../shared/types/triple-extraction.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';

export class SemanticMemorySimilarity {
  constructor(
    private db: Database.Database,
    private embeddingService: UnifiedEmbeddingService,
    private scoring: SemanticMemoryScoring
  ) {}

  async findDuplicateSemanticMemory(
    triple: Triple,
    similarityThreshold: number
  ): Promise<{ id: string; subject: string; predicate: string; object: string } | null> {
    const { normalizedSubject, normalizedPredicate, normalizedObject } =
      this.scoring.canonicalizeAndLink(triple);

    const exactMatch = DatabaseUtils.get(this.db, `
      SELECT id, subject, predicate, object
      FROM memory_item
      WHERE type = 'semantic'
        AND predicate = ?
        AND subject = ?
        AND object = ?
      LIMIT 1
    `, [normalizedPredicate, normalizedSubject, normalizedObject]) as {
      id: string;
      subject: string;
      predicate: string;
      object: string;
    } | undefined;

    if (exactMatch) {
      return exactMatch;
    }

    const candidates = DatabaseUtils.all(this.db, `
      SELECT id, subject, predicate, object, content
      FROM memory_item
      WHERE type = 'semantic'
        AND predicate = ?
    `, [normalizedPredicate]) as Array<{
      id: string;
      subject: string;
      predicate: string;
      object: string;
      content: string;
    }>;

    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      const subjectSimilar = await this.checkSimilarity(
        normalizedSubject,
        candidate.subject,
        similarityThreshold
      );
      const objectSimilar = await this.checkSimilarity(
        normalizedObject,
        candidate.object,
        similarityThreshold
      );

      if (subjectSimilar && objectSimilar) {
        return {
          id: candidate.id,
          subject: candidate.subject,
          predicate: candidate.predicate,
          object: candidate.object
        };
      }
    }

    return null;
  }

  async checkSimilarity(entity1: string, entity2: string, threshold: number): Promise<boolean> {
    const normalized1 = entity1.toLowerCase().trim();
    const normalized2 = entity2.toLowerCase().trim();

    if (normalized1 === normalized2) {
      return true;
    }

    if (!this.embeddingService) {
      logger.warn('SemanticMemoryUpdateService: embeddingService is not available', {
        entity1,
        entity2
      });
      return false;
    }

    if (typeof this.embeddingService.isAvailable !== 'function') {
      logger.warn('SemanticMemoryUpdateService: embeddingService.isAvailable is not a function', {
        entity1,
        entity2
      });
      return false;
    }

    if (!this.embeddingService.isAvailable()) {
      return false;
    }

    if (typeof this.embeddingService.generateEmbedding !== 'function') {
      logger.error('SemanticMemoryUpdateService: embeddingService.generateEmbedding is not a function', {
        entity1,
        entity2,
        embeddingServiceType: typeof this.embeddingService
      });
      return false;
    }

    try {
      const embedding1 = await this.embeddingService.generateEmbedding(entity1);
      const embedding2 = await this.embeddingService.generateEmbedding(entity2);

      if (!embedding1 || !embedding2) {
        return false;
      }

      const similarity = this.cosineSimilarity(embedding1.embedding, embedding2.embedding);
      return similarity >= threshold;
    } catch (error) {
      logger.warn('SemanticMemoryUpdateService: 유사도 계산 실패', {
        error: error instanceof Error ? error.message : String(error),
        entity1,
        entity2
      });
      return false;
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }
}
