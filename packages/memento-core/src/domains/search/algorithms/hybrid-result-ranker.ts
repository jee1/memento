import Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import { getRankingWeights } from '../../../shared/config/ranking-weights-loader.js';
import type { ProcessAttribute } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { FeedbackRepository, sigmoidNormalizedNet } from '../../memory/repositories/feedback-repository.js';
import { ProcessAttributeRepository } from '../../memory/repositories/process-attribute-repository.js';
import type { VectorSearchResult } from '../../memory/services/memory-embedding-service.js';
import { RelationGraph } from '../../relation/services/relation-graph.js';
import { computeProcessAttributeFit } from './process-attribute-fit.js';
import { SearchRanking, type SearchFeatures } from './search-ranking.js';
import { SearchError, SearchErrorType } from './search-error.js';
import type {
  HybridSearchQuery,
  HybridSearchResult,
  HybridWeights,
  IProceduralMemoryMatcher,
  ISearchResultCombiner,
  MemoryRankingDetails,
  ProceduralMemoryMatch,
  RankingContext,
  RelationInfoRow,
} from './hybrid-search-types.js';

export class HybridResultRanker {
  constructor(
    private resultCombiner: ISearchResultCombiner,
    private ranking: SearchRanking,
    private proceduralMemoryMatcher: IProceduralMemoryMatcher,
    private getRelationGraph: () => RelationGraph | null
  ) {}

  async combineAndSortResults(
    textResults: unknown[],
    vectorResults: VectorSearchResult[],
    weights: HybridWeights,
    limit: number,
    db: Database.Database,
    includeRelations: boolean,
    query: HybridSearchQuery
  ): Promise<HybridSearchResult[]> {
    try {
      const combinedResults = this.mergeResults(textResults, vectorResults, weights);

      const memoryIds = combinedResults.map(r => r.id);
      if (memoryIds.length > 0) {
        const processId =
          query.filters?.process_id != null
            ? Array.isArray(query.filters.process_id)
              ? query.filters.process_id[0]
              : query.filters.process_id
            : undefined;
        const ctx = await this.buildRankingContext(db, memoryIds, processId, query);
        this.normalizeScores(
          combinedResults,
          ctx,
          includeRelations,
          query.include_score_breakdown === true
        );
      }

      return this.sortByFinalScore(this.deduplicateResults(combinedResults)).slice(0, limit);
    } catch (error) {
      throw new SearchError(
        SearchErrorType.RESULT_COMBINATION_FAILED,
        '결과 결합 중 오류가 발생했습니다',
        error instanceof Error ? error : new Error(String(error)),
        { textResultsCount: textResults.length, vectorResultsCount: vectorResults.length, weights }
      );
    }
  }

  private mergeResults(
    textResults: unknown[],
    vectorResults: VectorSearchResult[],
    weights: HybridWeights
  ): HybridSearchResult[] {
    return this.resultCombiner.combine(
      textResults,
      vectorResults,
      weights.textWeight,
      weights.vectorWeight
    );
  }

  private normalizeScores(
    results: HybridSearchResult[],
    ctx: RankingContext,
    includeRelations: boolean,
    includeScoreBreakdown: boolean
  ): void {
    results.forEach(result => {
      const relationWeight = ctx.relationWeights.get(result.id);

      if (relationWeight !== undefined && relationWeight > 0) {
        result.relation_weight = relationWeight;
      }

      if (includeRelations) {
        const relations = ctx.relationInfo.get(result.id);
        if (relations && relations.length > 0) {
          result.relations = relations.map(r => ({
            target_id: r.target_id,
            relation_type: r.relation_type,
            confidence: r.confidence,
          }));
        }
      }

      const proceduralMatch = ctx.proceduralMatches.get(result.id);
      const consolidationScore = ctx.consolidationScores.get(result.id);
      const memoryDetails = ctx.memoryDetailsMap.get(result.id);
      const processAttributeFit =
        ctx.processAttributes != null && memoryDetails != null
          ? computeProcessAttributeFit(ctx.processAttributes, memoryDetails)
          : undefined;
      const feedback_score = sigmoidNormalizedNet(ctx.feedbackScores.get(result.id) ?? 0);

      const baseFeatures = this.buildBaseFeatures(
        result,
        relationWeight || 0,
        proceduralMatch,
        feedback_score,
        processAttributeFit
      );

      if (consolidationScore !== undefined) {
        result.consolidation_score = consolidationScore;
        this.applyScore(result, {
          ...baseFeatures,
          relevance: result.vectorScore,
          consolidation_score: consolidationScore,
        }, includeScoreBreakdown);
      } else {
        this.applyScore(result, baseFeatures, includeScoreBreakdown);
      }
    });
  }

  private buildBaseFeatures(
    result: HybridSearchResult,
    relationWeight: number,
    proceduralMatch: ProceduralMemoryMatch | undefined,
    feedbackScore: number,
    processAttributeFit: number | undefined
  ): SearchFeatures {
    return {
      relevance: result.vectorScore || result.textScore || 0,
      recency: this.calculateRecency(result.created_at),
      importance: result.importance || 0.5,
      usage: this.calculateUsage(result.last_accessed),
      relation_weight: relationWeight,
      duplication_penalty: 0,
      workflow_name_match: proceduralMatch?.workflow_name_match || false,
      skill_name_match: proceduralMatch?.skill_name_match || false,
      trigger_conditions_match: proceduralMatch?.trigger_conditions_match || false,
      feedback_score: feedbackScore,
      ...(processAttributeFit !== undefined && { process_attribute_fit: processAttributeFit }),
    };
  }

  private applyScore(
    result: HybridSearchResult,
    features: SearchFeatures,
    includeScoreBreakdown: boolean
  ): void {
    if (includeScoreBreakdown) {
      const { score, breakdown } = this.ranking.calculateFinalScoreAndBreakdown(features, {
        includeBreakdown: true,
      });
      result.finalScore = score;
      if (breakdown) {
        result.score_breakdown = breakdown;
      }
      return;
    }

    result.finalScore = this.ranking.calculateFinalScore(features);
  }

  private deduplicateResults(results: HybridSearchResult[]): HybridSearchResult[] {
    const resultMap = new Map<string, HybridSearchResult>();

    results.forEach(result => {
      const existing = resultMap.get(result.id);
      if (!existing || result.finalScore > existing.finalScore) {
        resultMap.set(result.id, result);
      }
    });

    return Array.from(resultMap.values());
  }

  private sortByFinalScore(results: HybridSearchResult[]): HybridSearchResult[] {
    return [...results].sort((a, b) => b.finalScore - a.finalScore);
  }

  private async buildRankingContext(
    db: Database.Database,
    memoryIds: string[],
    processId: string | undefined,
    query: HybridSearchQuery
  ): Promise<RankingContext> {
    const relationData = await this.fetchRelationWeights(memoryIds);
    const consolidationScores = mementoConfig.consolidationScoreEnabled
      ? this.fetchConsolidationScores(db, memoryIds)
      : new Map<string, number>();
    const proceduralMatches = this.proceduralMemoryMatcher.fetchProceduralMemoryMatches(
      db,
      memoryIds,
      query
    );
    const { processAttributes, memoryDetailsMap } = this.fetchProcessAttributeContext(
      db,
      memoryIds,
      processId
    );

    return {
      relationWeights: relationData.weights,
      relationInfo: relationData.relations,
      consolidationScores,
      proceduralMatches,
      processAttributes,
      memoryDetailsMap,
      feedbackScores: this.fetchFeedbackScores(db, memoryIds),
    };
  }

  private fetchConsolidationScores(db: Database.Database, memoryIds: string[]): Map<string, number> {
    const scores = new Map<string, number>();

    if (memoryIds.length === 0) {
      return scores;
    }

    try {
      const placeholders = memoryIds.map(() => '?').join(',');
      const sql = `SELECT id, consolidation_score FROM memory_item WHERE id IN (${placeholders})`;
      const results = db.prepare(sql).all(...memoryIds) as Array<{
        id: string;
        consolidation_score: number | null;
      }>;

      results.forEach(row => {
        if (row.consolidation_score !== null && row.consolidation_score !== undefined) {
          scores.set(row.id, Number(row.consolidation_score));
        }
      });
    } catch (error) {
      const maskedError = error instanceof Error
        ? PIIMasker.maskError(error)
        : { message: String(error), name: 'Error' };
      logger.warn('Consolidation Score 조회 실패', {
        error: maskedError.message,
      });
    }

    return scores;
  }

  private fetchFeedbackScores(
    db: Database.Database,
    memoryIds: string[]
  ): Map<string, number> {
    try {
      return new FeedbackRepository(db).getNetScores(memoryIds, 90);
    } catch (err) {
      const maskedError = err instanceof Error
        ? PIIMasker.maskError(err)
        : { message: String(err), name: 'Error' };
      logger.warn('피드백 순합 조회 실패 — 피드백 없이 진행', {
        error: maskedError.message,
      });
      return new Map();
    }
  }

  private fetchProcessAttributeContext(
    db: Database.Database,
    memoryIds: string[],
    processId: string | undefined
  ): {
    processAttributes: ProcessAttribute | null;
    memoryDetailsMap: Map<string, MemoryRankingDetails>;
  } {
    if (!processId) {
      return { processAttributes: null, memoryDetailsMap: new Map() };
    }

    const attrRepo = new ProcessAttributeRepository(db);
    const processAttributes = attrRepo.getByProcessId(processId);
    const memoryDetailsMap = new Map<string, MemoryRankingDetails>();

    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT id, tags, workflow_name, skill_name FROM memory_item WHERE id IN (${placeholders})`)
        .all(...memoryIds) as Array<{
          id: string;
          tags: string | null;
          workflow_name: string | null;
          skill_name: string | null;
        }>;

      for (const row of rows) {
        let tags: string[] = [];
        if (row.tags) {
          try {
            const parsed = JSON.parse(row.tags);
            tags = Array.isArray(parsed) ? parsed : [];
          } catch {
            tags = [];
          }
        }
        memoryDetailsMap.set(row.id, {
          tags,
          workflow_name: row.workflow_name ?? null,
          skill_name: row.skill_name ?? null,
        });
      }
    }

    return { processAttributes, memoryDetailsMap };
  }

  private async fetchRelationWeights(
    memoryIds: string[]
  ): Promise<{
    weights: Map<string, number>;
    relations: Map<string, RelationInfoRow[]>;
  }> {
    const weights = new Map<string, number>();
    const relations = new Map<string, RelationInfoRow[]>();
    const relationGraph = this.getRelationGraph();

    if (memoryIds.length === 0 || !relationGraph) {
      return { weights, relations };
    }

    try {
      const config = getRankingWeights();
      const maxRelations = config.relation_weights.max_relations;
      const relationsByMemory = await relationGraph.getRelationsBatch(memoryIds, {
        direction: 'both',
        minConfidence: 0.5,
      });

      for (const memoryId of memoryIds) {
        const memoryRelations = relationsByMemory.get(memoryId) ?? [];
        if (memoryRelations.length > 0) {
          const relationData = memoryRelations.map(r => ({
            confidence: r.confidence,
            relation_type: r.relation_type,
          }));
          weights.set(memoryId, this.ranking.calculateRelationWeight(relationData, maxRelations));
          relations.set(memoryId, memoryRelations.map(r => ({
            target_id: r.source_id === memoryId ? r.target_id : r.source_id,
            relation_type: r.relation_type,
            confidence: r.confidence,
          })));
        }
      }
    } catch (error) {
      const maskedError = error instanceof Error
        ? PIIMasker.maskError(error)
        : { message: String(error), name: 'Error' };
      logger.warn('관계 가중치 계산 실패', {
        error: maskedError.message,
      });
    }

    return { weights, relations };
  }

  private calculateRecency(createdAt: string | Date | undefined): number {
    if (!createdAt) return 0.5;

    const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
    const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);

    return Math.exp(-Math.log(2) * ageDays / 30);
  }

  private calculateUsage(lastAccessed: string | Date | undefined): number {
    if (!lastAccessed) return 0.1;

    const accessed = typeof lastAccessed === 'string' ? new Date(lastAccessed) : lastAccessed;
    const daysSinceAccess = (Date.now() - accessed.getTime()) / (1000 * 60 * 60 * 24);

    return Math.exp(-daysSinceAccess / 30);
  }
}
