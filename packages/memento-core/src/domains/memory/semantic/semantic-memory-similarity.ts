/**
 * Semantic Memory 중복 검색·임베딩 유사도
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import type { NormalizedTripleSnapshot } from './semantic-memory-update-types.js';

export interface SemanticCandidateSnapshot {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number | null;
  numTimes: number;
  ownerId: string | null;
  projectId: string | null;
  createdAt: string;
}

export type CandidateDecision =
  | { kind: 'exact' | 'similar'; candidate: SemanticCandidateSnapshot }
  | { kind: 'none' }
  | { kind: 'indeterminate'; reason: string };

type SimilarityDecision =
  | { kind: 'match' | 'no_match' }
  | { kind: 'indeterminate'; reason: string };

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export class SemanticMemorySimilarity {
  constructor(
    private db: Database.Database,
    private embeddingService: UnifiedEmbeddingService
  ) {}

  async findDuplicateSemanticMemory(
    snapshot: NormalizedTripleSnapshot,
    sourceScope: { ownerId: string | null; projectId: string | null },
    similarityThreshold: number
  ): Promise<CandidateDecision> {
    let candidates: SemanticCandidateSnapshot[];
    try {
      candidates = DatabaseUtils.all(this.db, `
        SELECT
          m.id,
          m.subject,
          m.predicate,
          m.object,
          m.confidence,
          m.num_times AS numTimes,
          m.owner_id AS ownerId,
          m.project_id AS projectId,
          COALESCE(m.created_at, '') AS createdAt
        FROM memory_item m
        WHERE m.type = 'semantic'
          AND m.is_deleted = 0
          AND m.owner_id IS ?
          AND m.project_id IS ?
          AND m.predicate = ?
          AND trim(m.subject) != ''
          AND trim(m.predicate) != ''
          AND trim(m.object) != ''
          AND (
            m.confidence IS NULL OR (
              typeof(m.confidence) IN ('integer', 'real')
              AND m.confidence BETWEEN 0 AND 1
            )
          )
          AND typeof(m.importance) IN ('integer', 'real')
          AND m.importance BETWEEN 0 AND 1
          AND typeof(m.num_times) = 'integer'
          AND m.num_times > 0
          AND m.num_times < ?
          AND (
            (
              CASE WHEN json_valid(m.origin_source)
                THEN json_extract(m.origin_source, '$.tool')
              END
            ) = 'extract_triples'
            AND (
              CASE WHEN json_valid(m.origin_source)
                THEN json_extract(m.origin_source, '$.caller')
              END
            ) = 'system'
            AND typeof(
              CASE WHEN json_valid(m.origin_source)
                THEN json_extract(m.origin_source, '$.context.source_episodic_id')
              END
            ) = 'text'
            AND trim(
              CASE WHEN json_valid(m.origin_source)
                THEN json_extract(m.origin_source, '$.context.source_episodic_id')
              END
            ) != ''
            OR (
              (m.origin_source IS NULL OR trim(m.origin_source) IN ('', '{}'))
              AND EXISTS (
                SELECT 1
                FROM memory_relation relation
                WHERE relation.source_id = m.id
                  AND relation.relation_type = 'extracted_from'
              )
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM kg_triple kg
            WHERE kg.representative_memory_id = m.id
              AND (
                kg.subject IS NOT m.subject
                OR kg.predicate IS NOT m.predicate
                OR kg.object IS NOT m.object
              )
          )
        ORDER BY m.created_at, m.id
      `, [
        sourceScope.ownerId,
        sourceScope.projectId,
        snapshot.predicate,
        Number.MAX_SAFE_INTEGER
      ]) as SemanticCandidateSnapshot[];
    } catch {
      return { kind: 'indeterminate', reason: 'candidate_lookup_failed' };
    }

    const exact = candidates.find((candidate) =>
      candidate.subject === snapshot.subject && candidate.object === snapshot.object
    );
    if (exact) {
      return { kind: 'exact', candidate: exact };
    }
    if (candidates.length === 0) {
      return { kind: 'none' };
    }

    try {
      if (
        !this.embeddingService ||
        typeof this.embeddingService.isAvailable !== 'function' ||
        !this.embeddingService.isAvailable() ||
        typeof this.embeddingService.generateEmbedding !== 'function'
      ) {
        return { kind: 'indeterminate', reason: 'similarity_unavailable' };
      }

      const inputEmbeddings = new Map<'subject' | 'object', Promise<number[] | null>>();
      const inputEmbedding = (field: 'subject' | 'object'): Promise<number[] | null> => {
        let pending = inputEmbeddings.get(field);
        if (!pending) {
          pending = this.generateEmbedding(snapshot[field]);
          inputEmbeddings.set(field, pending);
        }
        return pending;
      };

      for (const candidate of candidates) {
        const subject = await this.compare(
          snapshot.subject,
          candidate.subject,
          () => inputEmbedding('subject'),
          similarityThreshold
        );
        if (subject.kind === 'indeterminate') {
          return subject;
        }
        if (subject.kind === 'no_match') {
          continue;
        }

        const object = await this.compare(
          snapshot.object,
          candidate.object,
          () => inputEmbedding('object'),
          similarityThreshold
        );
        if (object.kind === 'indeterminate') {
          return object;
        }
        if (object.kind === 'match') {
          return { kind: 'similar', candidate };
        }
      }
    } catch {
      return { kind: 'indeterminate', reason: 'similarity_unavailable' };
    }

    return { kind: 'none' };
  }

  async checkSimilarity(entity1: string, entity2: string, threshold: number): Promise<boolean> {
    if (entity1.toLowerCase().trim() === entity2.toLowerCase().trim()) {
      return true;
    }
    if (!this.embeddingService?.isAvailable()) {
      return false;
    }

    try {
      const first = await this.generateEmbedding(entity1);
      const decision = await this.compare(entity1, entity2, async () => first, threshold);
      return decision.kind === 'match';
    } catch {
      return false;
    }
  }

  private async compare(
    input: string,
    candidate: string,
    inputEmbedding: () => Promise<number[] | null>,
    threshold: number
  ): Promise<SimilarityDecision> {
    if (input.toLowerCase().trim() === candidate.toLowerCase().trim()) {
      return { kind: 'match' };
    }

    const [inputVector, candidateVector] = await Promise.all([
      inputEmbedding(),
      this.generateEmbedding(candidate)
    ]);
    if (!inputVector || !candidateVector) {
      return { kind: 'indeterminate', reason: 'similarity_unavailable' };
    }

    const score = cosineSimilarity(inputVector, candidateVector);
    if (!isUnitNumber(score)) {
      return { kind: 'indeterminate', reason: 'invalid_similarity' };
    }
    return { kind: score >= threshold ? 'match' : 'no_match' };
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    const result = await this.embeddingService.generateEmbedding(text);
    return result && Array.isArray(result.embedding) ? result.embedding : null;
  }
}
