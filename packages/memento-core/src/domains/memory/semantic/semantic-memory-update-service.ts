/**
 * Semantic Memory 갱신 서비스
 *
 * Triple 추출 결과를 기반으로 Semantic Memory를 생성하거나 업데이트합니다.
 */

import Database from 'better-sqlite3';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import type { RelationGraphPort } from '../../relation/ports/relation-graph.port.js';
import { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { SemanticMemoryCrud } from './semantic-memory-crud.js';
import { SemanticMemoryRelations } from './semantic-memory-relations.js';
import { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import { SemanticMemorySimilarity } from './semantic-memory-similarity.js';
import { SemanticMemoryStatisticsService } from './semantic-memory-statistics.js';
import { SemanticMemoryUpdatePipeline } from './semantic-memory-update-pipeline.js';
import type {
  EpisodicSourceSnapshot,
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
    kgTripleRepo?: KgTripleRepository,
    memoryEmbeddingService?: MemoryEmbeddingService
  ) {
    const resolvedEmbeddingService = this.resolveEmbeddingService(embeddingService);
    this.embeddingService = resolvedEmbeddingService;

    this.scoring = new SemanticMemoryScoring();
    this.kgTripleRepo = kgTripleRepo ?? new KgTripleRepository(db);
    this.similarity = new SemanticMemorySimilarity(db, resolvedEmbeddingService, this.scoring);
    this.crud = new SemanticMemoryCrud(db, this.kgTripleRepo, this.scoring, memoryEmbeddingService);
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
    extractionResult: unknown,
    options: unknown
  ): Promise<SemanticMemoryUpdateResult> {
    const processingStartTime = Date.now();

    const request = this.pipeline.validateAndSnapshotRequest(extractionResult, options);
    if (request.kind === 'empty') {
      return request.result;
    }
    const source = this.snapshotEpisodicSource(request.policy.episodicMemoryId);
    const providedImportance = (options as { episodicImportance?: number }).episodicImportance;
    const episodicImportance = providedImportance === undefined
      ? source.importance ?? 0.5
      : request.policy.episodicImportance;
    if (!Number.isFinite(episodicImportance) || episodicImportance < 0 || episodicImportance > 1) {
      throw new TypeError('Invalid semantic update source importance');
    }
    const policy = { ...request.policy, episodicImportance };

    const preparedData = this.pipeline.prepareUpdateData(policy);
    const { result, confidences, hasError } = await this.pipeline.applyUpdates(
      request.positions,
      request.extractionInfo,
      source,
      policy,
      preparedData
    );

    this.pipeline.notifyListeners(
      result,
      request.positions.length,
      confidences,
      processingStartTime,
      hasError
    );

    return result;
  }

  getStatistics() {
    return this.statistics.getStatistics();
  }

  private snapshotEpisodicSource(episodicMemoryId: string): EpisodicSourceSnapshot {
    const row = this.db.prepare(`
      SELECT
        id,
        type,
        content,
        importance,
        owner_id AS ownerId,
        project_id AS projectId,
        is_deleted AS isDeleted,
        triple_extracted AS tripleExtracted,
        triple_extracted_status AS tripleExtractedStatus,
        triple_extraction_metadata AS tripleExtractionMetadata
      FROM memory_item
      WHERE id = ?
    `).get(episodicMemoryId) as (Omit<EpisodicSourceSnapshot, 'type' | 'isDeleted'> & {
      type: string;
      isDeleted: number | null;
    }) | undefined;

    if (!row || row.type !== 'episodic' || row.isDeleted !== 0) {
      throw new Error(`Invalid episodic source memory: ${episodicMemoryId}`);
    }

    return {
      id: row.id,
      type: 'episodic',
      content: row.content,
      importance: row.importance,
      ownerId: row.ownerId,
      projectId: row.projectId,
      isDeleted: false,
      tripleExtracted: row.tripleExtracted,
      tripleExtractedStatus: row.tripleExtractedStatus,
      tripleExtractionMetadata: row.tripleExtractionMetadata
    };
  }
}
