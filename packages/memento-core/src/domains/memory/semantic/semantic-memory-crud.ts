/**
 * Semantic Memory 생성·병합 업데이트
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import {
  generateSemanticMemoryId,
  type EpisodicSourceSnapshot,
  type NormalizedTripleSnapshot,
  type SemanticMemoryUpdateOptions
} from './semantic-memory-update-types.js';

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
  ): Promise<{ id: string; confidence: number; content: string; kind: 'created' }> {
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

    this.db.transaction(() => {
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
    })();

    try {
      logger.debug('SemanticMemoryUpdateService: Semantic Memory 생성', {
        id,
        confidence: snapshot.confidence,
        importance
      });
    } catch {
      // A committed primary write must not depend on logging.
    }

    return { id, confidence: snapshot.confidence, content, kind: 'created' };
  }

  async createSemanticEmbedding(memoryId: string, content: string): Promise<void> {
    await this.memoryEmbeddingService.createAndStoreEmbedding(this.db, memoryId, content, 'semantic');
  }

  async updateExistingSemanticMemory(
    semanticMemoryId: string,
    options: SemanticMemoryUpdateOptions,
    confidence: number
  ): Promise<void> {
    const existing = DatabaseUtils.get(this.db, `
      SELECT id, importance, recall_count
      FROM memory_item
      WHERE id = ?
    `, [semanticMemoryId]) as { id: string; importance: number; recall_count: number } | undefined;

    if (!existing) {
      throw new Error(`Semantic Memory를 찾을 수 없습니다: ${semanticMemoryId}`);
    }

    const episodeWeight = (existing.recall_count || 0) + 1;
    const newImportance = this.scoring.calculateImportance(
      options.episodicImportance || 0.5,
      episodeWeight
    );

    const nowIso = new Date().toISOString();
    await DatabaseUtils.run(this.db, `
      UPDATE memory_item
      SET importance = ?,
          recall_count = recall_count + 1,
          last_accessed_at = CURRENT_TIMESTAMP,
          num_times = COALESCE(num_times, 1) + 1,
          last_mentioned_at = ?
      WHERE id = ?
    `, [newImportance, nowIso, semanticMemoryId]);

    try {
      logger.debug('SemanticMemoryUpdateService: Semantic Memory 업데이트 (병합)', {
        id: semanticMemoryId,
        episodeWeight,
        oldImportance: existing.importance,
        newImportance,
        confidence
      });
    } catch {
      // A committed primary write must not depend on logging.
    }
  }
}
