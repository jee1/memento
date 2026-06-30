/**
 * Semantic Memory 갱신 서비스
 *
 * Triple 추출 결과를 기반으로 Semantic Memory를 생성하거나 업데이트합니다.
 */

import Database from 'better-sqlite3';
import type { TripleExtractionResult } from '../../../../shared/types/triple-extraction.js';
import { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import type { RelationGraphPort } from '../../../relation/ports/relation-graph.port.js';
import { KgTripleRepository } from '../../repositories/kg-triple-repository.js';
import { SemanticMemoryCrud } from './semantic-memory-crud.js';
import { SemanticMemoryRelations } from './semantic-memory-relations.js';
import { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import { SemanticMemorySimilarity } from './semantic-memory-similarity.js';
import { SemanticMemoryStatisticsService } from './semantic-memory-statistics.js';
import { SemanticMemoryUpdatePipeline } from './semantic-memory-update-pipeline.js';
import type {
  SemanticMemoryUpdateOptions,
  SemanticMemoryUpdateResult
} from './semantic-memory-update-types.js';

export type {
  SemanticMemoryUpdateOptions,
  SemanticMemoryUpdateResult
} from './semantic-memory-update-types.js';

/**
 * Semantic Memory 갱신 서비스 (composition 오케스트레이터)
 */
export class SemanticMemoryUpdateService {
  private readonly embeddingService: UnifiedEmbeddingService;
  private readonly scoring: SemanticMemoryScoring;
  private readonly similarity: SemanticMemorySimilarity;
  private readonly crud: SemanticMemoryCrud;
  private readonly relations: SemanticMemoryRelations;
  private readonly pipeline: SemanticMemoryUpdatePipeline;
  private readonly statistics: SemanticMemoryStatisticsService;
  private readonly kgTripleRepo: KgTripleRepository;

  constructor(
    private db: Database.Database,
    relationGraph: RelationGraphPort,
    embeddingService?: UnifiedEmbeddingService,
    kgTripleRepo?: KgTripleRepository
  ) {
    const resolvedEmbeddingService = this.resolveEmbeddingService(embeddingService);
    this.embeddingService = resolvedEmbeddingService;

    this.scoring = new SemanticMemoryScoring();
    this.kgTripleRepo = kgTripleRepo ?? new KgTripleRepository(db);
    this.similarity = new SemanticMemorySimilarity(db, resolvedEmbeddingService, this.scoring);
    this.crud = new SemanticMemoryCrud(db, this.kgTripleRepo, this.scoring);
    this.relations = new SemanticMemoryRelations(db, relationGraph);
    this.statistics = new SemanticMemoryStatisticsService();
    this.pipeline = new SemanticMemoryUpdatePipeline(
      db,
      this.scoring,
      this.similarity,
      this.crud,
      this.relations,
      this.kgTripleRepo,
      this.statistics
    );

    this.relations.ensureRelationTypes();
  }

  private resolveEmbeddingService(
    embeddingService?: UnifiedEmbeddingService
  ): UnifiedEmbeddingService {
    if (embeddingService) {
      if (typeof embeddingService.generateEmbedding !== 'function') {
        throw new Error('Invalid embeddingService: generateEmbedding method is missing');
      }
      if (typeof embeddingService.isAvailable !== 'function') {
        throw new Error('Invalid embeddingService: isAvailable method is missing');
      }
      return embeddingService;
    }
    return new UnifiedEmbeddingService();
  }

  async updateSemanticMemory(
    extractionResult: TripleExtractionResult,
    options: SemanticMemoryUpdateOptions
  ): Promise<SemanticMemoryUpdateResult> {
    const processingStartTime = Date.now();

    const validationResult = this.pipeline.validateInput(extractionResult);
    if (validationResult) {
      return validationResult;
    }

    const preparedData = this.pipeline.prepareUpdateData(options);
    const { result, confidences, hasError } = await this.pipeline.applyUpdates(
      extractionResult,
      options,
      preparedData
    );

    this.pipeline.notifyListeners(
      result,
      extractionResult.triples.length,
      confidences,
      processingStartTime,
      hasError
    );

    return result;
  }

  getStatistics() {
    return this.statistics.getStatistics();
  }
}
