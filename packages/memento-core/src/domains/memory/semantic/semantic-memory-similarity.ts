/**
 * Semantic Memory 중복 검색·임베딩 유사도
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import type {
  EpisodicSourceSnapshot,
  NormalizedTripleSnapshot
} from './semantic-memory-update-types.js';

interface SemanticCandidate {
  id: string;
  subject: string;
  predicate: string;
  object: string;
}

interface EligibilityRow extends SemanticCandidate {
  type: string;
  confidence: number | null;
  importance: number | null;
  numTimes: number;
  ownerId: string | null;
  projectId: string | null;
  isDeleted: number;
  originSource: string | null;
  hasExtractedFrom: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export class SemanticMemorySimilarity {
  constructor(
    private db: Database.Database,
    private embeddingService: UnifiedEmbeddingService
  ) {}

  findEligibleSemanticMemoryById(
    id: string,
    snapshot: NormalizedTripleSnapshot,
    source: EpisodicSourceSnapshot
  ): SemanticCandidate | null {
    const row = DatabaseUtils.get(this.db, `
      SELECT
        m.id, m.type, m.subject, m.predicate, m.object, m.confidence, m.importance,
        m.num_times AS numTimes, m.owner_id AS ownerId, m.project_id AS projectId,
        m.is_deleted AS isDeleted, m.origin_source AS originSource,
        EXISTS (
          SELECT 1
          FROM memory_relation r
          WHERE r.source_id = m.id AND r.relation_type = 'extracted_from'
        ) AS hasExtractedFrom
      FROM memory_item m
      WHERE m.id = ?
    `, [id]) as EligibilityRow | undefined;

    return row && this.isEligible(row, snapshot, source)
      ? this.toCandidate(row)
      : null;
  }

  async findDuplicateSemanticMemory(
    snapshot: NormalizedTripleSnapshot,
    source: EpisodicSourceSnapshot,
    similarityThreshold: number
  ): Promise<SemanticCandidate | null> {
    const exactRows = DatabaseUtils.all(this.db, `
      SELECT
        m.id, m.type, m.subject, m.predicate, m.object, m.confidence, m.importance,
        m.num_times AS numTimes, m.owner_id AS ownerId, m.project_id AS projectId,
        m.is_deleted AS isDeleted, m.origin_source AS originSource,
        EXISTS (
          SELECT 1
          FROM memory_relation r
          WHERE r.source_id = m.id AND r.relation_type = 'extracted_from'
        ) AS hasExtractedFrom
      FROM memory_item m
      WHERE m.type = 'semantic'
        AND m.is_deleted = 0
        AND m.owner_id IS ?
        AND m.project_id IS ?
        AND m.predicate = ?
        AND m.subject = ?
        AND m.object = ?
      ORDER BY m.created_at, m.id
    `, [
      source.ownerId,
      source.projectId,
      snapshot.predicate,
      snapshot.subject,
      snapshot.object
    ]) as EligibilityRow[];
    const exactMatch = exactRows.find((row) => this.isEligible(row, snapshot, source));

    if (exactMatch) {
      return this.toCandidate(exactMatch);
    }

    const candidates = DatabaseUtils.all(this.db, `
      SELECT id, subject, predicate, object
      FROM memory_item
      WHERE type = 'semantic'
        AND predicate = ?
    `, [snapshot.predicate]) as Array<{
      id: string;
      subject: string;
      predicate: string;
      object: string;
    }>;

    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      if (candidate.subject === snapshot.subject && candidate.object === snapshot.object) {
        continue;
      }
      const subjectSimilar = await this.checkSimilarity(
        snapshot.subject,
        candidate.subject,
        similarityThreshold
      );
      const objectSimilar = await this.checkSimilarity(
        snapshot.object,
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

  private isEligible(
    row: EligibilityRow,
    snapshot: NormalizedTripleSnapshot,
    source: EpisodicSourceSnapshot
  ): boolean {
    return row.type === 'semantic' &&
      row.isDeleted === 0 &&
      row.ownerId === source.ownerId &&
      row.projectId === source.projectId &&
      row.subject === snapshot.subject &&
      row.predicate === snapshot.predicate &&
      row.object === snapshot.object &&
      row.subject.trim() !== '' &&
      row.predicate.trim() !== '' &&
      row.object.trim() !== '' &&
      (row.confidence === null || isUnitNumber(row.confidence)) &&
      isUnitNumber(row.importance) &&
      Number.isSafeInteger(row.numTimes) &&
      row.numTimes > 0 &&
      row.numTimes < Number.MAX_SAFE_INTEGER &&
      this.hasAutomaticProvenance(row);
  }

  private hasAutomaticProvenance(row: EligibilityRow): boolean {
    const rawOrigin = row.originSource?.trim() ?? '';
    if (rawOrigin === '' || rawOrigin === '{}') {
      return row.hasExtractedFrom === 1;
    }

    try {
      const origin = JSON.parse(rawOrigin) as unknown;
      if (!isRecord(origin) || origin.tool !== 'extract_triples' || origin.caller !== 'system') {
        return false;
      }
      const context = origin.context;
      return isRecord(context) &&
        typeof context.source_episodic_id === 'string' &&
        context.source_episodic_id.trim() !== '';
    } catch {
      return false;
    }
  }

  private toCandidate(row: SemanticCandidate): SemanticCandidate {
    return {
      id: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object
    };
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

      const similarity = cosineSimilarity(embedding1.embedding, embedding2.embedding);
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

}
