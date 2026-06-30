/**
 * Semantic Memory 생성·병합 업데이트
 */

import Database from 'better-sqlite3';
import type { Triple } from '../../../../shared/types/triple-extraction.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import { KgTripleRepository } from '../../repositories/kg-triple-repository.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import {
  generateSemanticMemoryId,
  type SemanticMemoryUpdateOptions
} from './semantic-memory-update-types.js';

export class SemanticMemoryCrud {
  constructor(
    private db: Database.Database,
    private kgTripleRepo: KgTripleRepository,
    private scoring: SemanticMemoryScoring
  ) {}

  async createSemanticMemory(
    triple: Triple,
    options: SemanticMemoryUpdateOptions,
    confidence: number
  ): Promise<string> {
    const { normalizedSubject, normalizedPredicate, normalizedObject } =
      this.scoring.canonicalizeAndLink(triple);

    const content = this.scoring.tripleToNaturalLanguage(
      normalizedSubject,
      normalizedPredicate,
      normalizedObject
    );

    const id = generateSemanticMemoryId();
    const importance = this.scoring.calculateImportance(options.episodicImportance || 0.5, 1);
    const createdAt = new Date().toISOString();

    await DatabaseUtils.run(this.db, `
      INSERT INTO memory_item (
        id, type, content, subject, predicate, object,
        importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      'semantic',
      content,
      normalizedSubject,
      normalizedPredicate,
      normalizedObject,
      importance,
      'private',
      createdAt
    ]);

    this.kgTripleRepo.upsertTriple({
      subject: normalizedSubject,
      predicate: normalizedPredicate,
      object: normalizedObject,
      representative_memory_id: id
    });

    logger.debug('SemanticMemoryUpdateService: Semantic Memory 생성', {
      id,
      originalTriple: triple,
      normalizedTriple: {
        subject: normalizedSubject,
        predicate: normalizedPredicate,
        object: normalizedObject
      },
      confidence,
      importance
    });

    return id;
  }

  async updateExistingSemanticMemory(
    semanticMemoryId: string,
    triple: Triple,
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

    logger.debug('SemanticMemoryUpdateService: Semantic Memory 업데이트 (병합)', {
      id: semanticMemoryId,
      triple,
      episodeWeight,
      oldImportance: existing.importance,
      newImportance,
      confidence
    });
  }
}
