/**
 * Semantic Memory 생성·병합 업데이트
 */

import Database from 'better-sqlite3';
import { logger } from '../../../shared/utils/logger.js';
import { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import type {
  CandidateDecision,
  SemanticCandidateSnapshot
} from './semantic-memory-similarity.js';
import {
  generateSemanticMemoryId,
  type EpisodicSourceSnapshot,
  type NormalizedTripleSnapshot
} from './semantic-memory-update-types.js';

export interface PreparedEvidenceOccurrence {
  firstIndex: number;
  representativeIndex: number;
  confidence: number;
  episodicImportance: number;
  duplicateIndexes: number[];
  decision: CandidateDecision;
}

export class SemanticMemoryCrud {
  private readonly memoryEmbeddingService: MemoryEmbeddingService;

  constructor(
    private db: Database.Database,
    private kgTripleRepo: KgTripleRepository,
    private scoring: SemanticMemoryScoring,
    memoryEmbeddingService?: MemoryEmbeddingService
  ) {
    this.memoryEmbeddingService = memoryEmbeddingService ?? new MemoryEmbeddingService();
  }

  async createSemanticMemory(
    snapshot: NormalizedTripleSnapshot,
    source: EpisodicSourceSnapshot,
    episodicImportance: number
  ): Promise<
    | { id: string; confidence: number; content: string; kind: 'created' }
    | { kind: 'candidate-stale' | 'source-stale' }
  > {
    if (
      !Number.isFinite(snapshot.confidence) ||
      snapshot.confidence < 0 ||
      snapshot.confidence > 1 ||
      !Number.isFinite(episodicImportance) ||
      episodicImportance < 0 ||
      episodicImportance > 1
    ) {
      throw new TypeError('Invalid semantic memory quality');
    }

    // #768: 재조립이 불가능한 triple은 합성 문장 대신 원본 episodic 본문을 보존한다.
    const content = this.scoring.tripleToNaturalLanguage(
      snapshot.subject,
      snapshot.predicate,
      snapshot.object,
      source.content
    );

    const id = generateSemanticMemoryId();
    const importance = this.scoring.calculateImportance(
      episodicImportance,
      snapshot.confidence,
      1
    );
    const createdAt = new Date().toISOString();
    const originSource = JSON.stringify({
      tool: 'extract_triples',
      caller: 'system',
      timestamp: createdAt,
      context: { source_episodic_id: source.id }
    });

    const created = this.db.transaction(() => {
      if (!this.sourceMatches(source)) {
        return { kind: 'source-stale' as const };
      }
      if (this.hasEligibleExactCandidate(snapshot, source)) {
        return { kind: 'candidate-stale' as const };
      }

      this.db.prepare(`
        INSERT INTO memory_item (
          id, type, content, subject, predicate, object, confidence, importance,
          num_times, owner_id, project_id, origin_source, privacy_scope, created_at
        ) VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'private', ?)
      `).run(
        id,
        content,
        snapshot.subject,
        snapshot.predicate,
        snapshot.object,
        snapshot.confidence,
        importance,
        source.ownerId,
        source.projectId,
        originSource,
        createdAt
      );

      if (!this.kgTripleRepo.getBySubjectPredicateObject(
        snapshot.subject,
        snapshot.predicate,
        snapshot.object
      )) {
        this.kgTripleRepo.upsertTriple({
          subject: snapshot.subject,
          predicate: snapshot.predicate,
          object: snapshot.object,
          representative_memory_id: id
        });
      }

      return { id, confidence: snapshot.confidence, content, kind: 'created' as const };
    }).immediate();

    if (created.kind !== 'created') {
      return created;
    }

    try {
      logger.debug('SemanticMemoryUpdateService: Semantic Memory 생성', {
        id,
        confidence: snapshot.confidence,
        importance
      });
    } catch {
      // A committed primary write must not depend on logging.
    }

    return created;
  }

  async createSemanticEmbedding(memoryId: string, content: string): Promise<void> {
    await this.memoryEmbeddingService.createAndStoreEmbedding(this.db, memoryId, content, 'semantic');
  }

  async updateExistingSemanticMemory(
    candidate: SemanticCandidateSnapshot,
    evidence: PreparedEvidenceOccurrence,
    source: EpisodicSourceSnapshot
  ): Promise<
    | { id: string; confidence: number; kind: 'updated' }
    | { kind: 'source-stale' }
    | null
  > {
    const updated = this.db.transaction(() => {
      if (!this.sourceMatches(source)) {
        return { kind: 'source-stale' as const };
      }
      return this.applyConditionalAggregateUpdate(candidate, evidence);
    }).immediate();
    if (updated?.kind === 'updated') {
      this.logAggregateUpdate(candidate, evidence, updated.confidence);
    }
    return updated;
  }

  async updateReevaluatedSemanticMemory(
    candidate: SemanticCandidateSnapshot,
    evidence: PreparedEvidenceOccurrence,
    source: EpisodicSourceSnapshot
  ): Promise<
    | { id: string; confidence: number; kind: 'updated' }
    | { kind: 'source-stale' }
    | null
  > {
    let updatedCandidate = candidate;
    const retry = this.db.transaction(() => {
      if (!this.sourceMatches(source)) {
        return { kind: 'source-stale' as const };
      }
      const latest = this.db.prepare(`
        SELECT confidence, num_times AS numTimes
        FROM memory_item
        WHERE id = ?
      `).get(candidate.id) as {
        confidence: number | null;
        numTimes: number;
      } | undefined;
      if (!latest) {
        return null;
      }

      updatedCandidate = { ...candidate, ...latest };
      return this.applyConditionalAggregateUpdate(updatedCandidate, evidence);
    });
    const updated = retry.immediate();
    if (updated?.kind === 'updated') {
      this.logAggregateUpdate(updatedCandidate, evidence, updated.confidence);
    }
    return updated;
  }

  private applyConditionalAggregateUpdate(
    candidate: SemanticCandidateSnapshot,
    evidence: PreparedEvidenceOccurrence
  ): { id: string; confidence: number; kind: 'updated' } | null {
    if (
      !Number.isFinite(evidence.confidence) ||
      evidence.confidence < 0 ||
      evidence.confidence > 1 ||
      !Number.isFinite(evidence.episodicImportance) ||
      evidence.episodicImportance < 0 ||
      evidence.episodicImportance > 1
    ) {
      throw new TypeError('Invalid semantic memory quality');
    }

    if (
      !Number.isSafeInteger(candidate.numTimes) ||
      candidate.numTimes <= 0 ||
      candidate.numTimes >= Number.MAX_SAFE_INTEGER ||
      (candidate.confidence !== null && (
        !Number.isFinite(candidate.confidence) ||
        candidate.confidence < 0 ||
        candidate.confidence > 1
      ))
    ) {
      return null;
    }

    const finalNumTimes = candidate.numTimes + 1;
    const aggregateConfidence = this.scoring.calculateAggregateConfidence(
      candidate.confidence,
      candidate.numTimes,
      evidence.confidence
    );
    const newImportance = this.scoring.calculateImportance(
      evidence.episodicImportance,
      aggregateConfidence,
      finalNumTimes
    );
    const nowIso = new Date().toISOString();
    const update = this.db.prepare(`
      UPDATE memory_item AS m
      SET confidence = ?,
          importance = ?,
          num_times = num_times + 1,
          last_mentioned_at = ?
      WHERE m.id = ?
        AND m.type = 'semantic'
        AND m.is_deleted = 0
        AND m.owner_id IS ?
        AND m.project_id IS ?
        AND m.subject = ?
        AND m.predicate = ?
        AND m.object = ?
        AND m.confidence IS ?
        AND m.num_times = ?
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
    `).run(
      aggregateConfidence,
      newImportance,
      nowIso,
      candidate.id,
      candidate.ownerId,
      candidate.projectId,
      candidate.subject,
      candidate.predicate,
      candidate.object,
      candidate.confidence,
      candidate.numTimes,
      Number.MAX_SAFE_INTEGER
    );

    if (update.changes === 0) {
      return null;
    }

    return { id: candidate.id, confidence: aggregateConfidence, kind: 'updated' };
  }

  private logAggregateUpdate(
    candidate: SemanticCandidateSnapshot,
    evidence: PreparedEvidenceOccurrence,
    confidence: number
  ): void {
    try {
      const numTimes = candidate.numTimes + 1;
      logger.debug('SemanticMemoryUpdateService: Semantic Memory 업데이트 (병합)', {
        id: candidate.id,
        oldConfidence: candidate.confidence,
        numTimes,
        newImportance: this.scoring.calculateImportance(
          evidence.episodicImportance,
          confidence,
          numTimes
        ),
        confidence
      });
    } catch {
      // A committed primary write must not depend on logging.
    }
  }

  private sourceMatches(source: EpisodicSourceSnapshot): boolean {
    return this.db.prepare(`
      SELECT 1
      FROM memory_item
      WHERE id = ?
        AND type = 'episodic'
        AND is_deleted = 0
        AND content IS ?
        AND importance IS ?
        AND owner_id IS ?
        AND project_id IS ?
    `).get(
      source.id,
      source.content,
      source.importance,
      source.ownerId,
      source.projectId
    ) !== undefined;
  }

  private hasEligibleExactCandidate(
    snapshot: NormalizedTripleSnapshot,
    source: EpisodicSourceSnapshot
  ): boolean {
    return this.db.prepare(`
      SELECT 1
      FROM memory_item m
      WHERE m.type = 'semantic'
        AND m.is_deleted = 0
        AND m.owner_id IS ?
        AND m.project_id IS ?
        AND m.subject = ?
        AND m.predicate = ?
        AND m.object = ?
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
      LIMIT 1
    `).get(
      source.ownerId,
      source.projectId,
      snapshot.subject,
      snapshot.predicate,
      snapshot.object,
      Number.MAX_SAFE_INTEGER
    ) !== undefined;
  }
}
