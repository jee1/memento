/**
 * Semantic Memory 업데이트 파이프라인
 */

import Database from 'better-sqlite3';
import type { ExtractionInfo, Triple, TripleExtractionResult } from '../../../shared/types/triple-extraction.js';
import { logger } from '../../../shared/utils/logger.js';
import { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
import { SemanticMemoryStatisticsService } from './semantic-memory-statistics.js';
import type { SemanticMemoryCrud } from './semantic-memory-crud.js';
import type { SemanticMemoryRelations } from './semantic-memory-relations.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import type { SemanticMemorySimilarity } from './semantic-memory-similarity.js';
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
  type PreparedUpdateData,
  type SemanticMemoryUpdateOptions,
  type SemanticMemoryUpdateResult
} from './semantic-memory-update-types.js';

export class SemanticMemoryUpdatePipeline {
  constructor(
    private db: Database.Database,
    private scoring: SemanticMemoryScoring,
    private similarity: SemanticMemorySimilarity,
    private crud: SemanticMemoryCrud,
    private relations: SemanticMemoryRelations,
    private kgTripleRepo: KgTripleRepository,
    private statistics: SemanticMemoryStatisticsService
  ) {}

  validateInput(extractionResult: TripleExtractionResult): SemanticMemoryUpdateResult | null {
    if (extractionResult.triples.length === 0) {
      return {
        created: 0,
        updated: 0,
        skipped: 0,
        semanticMemoryIds: []
      };
    }
    return null;
  }

  prepareUpdateData(options: SemanticMemoryUpdateOptions): PreparedUpdateData {
    return {
      confidenceThreshold: options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      similarityThreshold: options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      result: {
        created: 0,
        updated: 0,
        skipped: 0,
        semanticMemoryIds: []
      },
      confidences: [],
      hasError: false
    };
  }

  async applyUpdates(
    extractionResult: TripleExtractionResult,
    options: SemanticMemoryUpdateOptions,
    preparedData: PreparedUpdateData
  ): Promise<{
    result: SemanticMemoryUpdateResult;
    confidences: number[];
    hasError: boolean;
  }> {
    const { confidenceThreshold, similarityThreshold, result, confidences } = preparedData;
    let hasError = false;

    for (const triple of extractionResult.triples) {
      try {
        const processed = await this.processSingleTriple(
          triple,
          extractionResult.extractionInfo,
          options,
          confidenceThreshold,
          similarityThreshold,
          result
        );
        confidences.push(processed.confidence);
      } catch (error) {
        hasError = true;

        if (error instanceof Error && error.message.includes('관계 방향 오류')) {
          throw error;
        }

        logger.error('SemanticMemoryUpdateService: Triple 처리 실패', {
          error: error instanceof Error ? error.message : String(error),
          triple
        });
        result.skipped++;
      }
    }

    return { result, confidences, hasError };
  }

  async processSingleTriple(
    triple: Triple,
    extractionInfo: ExtractionInfo,
    options: SemanticMemoryUpdateOptions,
    confidenceThreshold: number,
    similarityThreshold: number,
    result: SemanticMemoryUpdateResult
  ): Promise<{ confidence: number }> {
    const confidence = this.scoring.calculateConfidence(triple, extractionInfo);

    if (confidence < confidenceThreshold) {
      result.skipped++;
      logger.debug('SemanticMemoryUpdateService: Confidence가 임계값 미만', {
        triple,
        confidence,
        threshold: confidenceThreshold,
        reason: 'confidence_below_threshold'
      });
      return { confidence };
    }

    const norm = this.scoring.normalizeTripleForKg(triple);
    const existingKg = this.kgTripleRepo.getBySubjectPredicateObject(
      norm.subject,
      norm.predicate,
      norm.object
    );
    if (existingKg?.representative_memory_id) {
      const targetRow = this.db.prepare('SELECT type FROM memory_item WHERE id = ?')
        .get(existingKg.representative_memory_id) as { type: string } | undefined;
      if (targetRow?.type === 'semantic') {
        this.db.prepare(
          'UPDATE memory_item SET num_times = num_times + 1, last_mentioned_at = ?, recall_count = recall_count + 1 WHERE id = ?'
        ).run(new Date().toISOString(), existingKg.representative_memory_id);
        result.updated++;
        result.semanticMemoryIds.push(existingKg.representative_memory_id);
        await this.relations.createEpisodicEdge(
          options.episodicMemoryId,
          existingKg.representative_memory_id,
          triple,
          extractionInfo,
          confidence
        );
        return { confidence };
      }
    }

    const duplicate = await this.similarity.findDuplicateSemanticMemory(triple, similarityThreshold);

    if (duplicate) {
      await this.crud.updateExistingSemanticMemory(duplicate.id, triple, options, confidence);
      result.updated++;
      result.semanticMemoryIds.push(duplicate.id);
    } else {
      const semanticMemoryId = await this.crud.createSemanticMemory(triple, options, confidence);
      result.created++;
      result.semanticMemoryIds.push(semanticMemoryId);
    }

    try {
      const semanticMemoryId = duplicate?.id || result.semanticMemoryIds[result.semanticMemoryIds.length - 1];
      if (!semanticMemoryId) {
        throw new Error('Semantic memory ID is required for creating episodic edge');
      }
      await this.relations.createEpisodicEdge(
        options.episodicMemoryId,
        semanticMemoryId,
        triple,
        extractionInfo,
        confidence
      );
    } catch (edgeError) {
      if (edgeError instanceof Error && edgeError.message.includes('관계 방향 오류')) {
        throw edgeError;
      }
      logger.warn('SemanticMemoryUpdateService: 관계 생성 실패 (무시)', {
        error: edgeError instanceof Error ? edgeError.message : String(edgeError),
        triple
      });
    }

    return { confidence };
  }

  notifyListeners(
    result: SemanticMemoryUpdateResult,
    totalTriples: number,
    confidences: number[],
    processingStartTime: number,
    hasError: boolean
  ): void {
    const processingTime = Date.now() - processingStartTime;
    const duplicates = totalTriples - (result.created + result.updated + result.skipped);
    this.statistics.recordUpdate(
      result.created,
      result.updated,
      result.skipped,
      duplicates,
      confidences,
      processingTime,
      hasError
    );
  }
}
