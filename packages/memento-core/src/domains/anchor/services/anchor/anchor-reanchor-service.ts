/**
 * Auto-reanchor scoring and movement workflow.
 */

import type Database from 'better-sqlite3';
import type {
  AnchorSlot,
  IAnchorCacheService,
  IAnchorManager
} from './anchor-interfaces.js';
import { DatabaseValidationError, VectorDimensionMismatchError } from './anchor-interfaces.js';
import type { NHopSearchResult, NHopSearchService } from './n-hop-search-service.js';
import { logger } from '../../../../shared/utils/logger.js';
import { ErrorCategory, ErrorSeverity, ErrorLoggingService } from '../../../../domains/monitoring/services/error-logging-service.js';

export type AutoReanchorResult = {
  moved: boolean;
  old_anchor: string | null;
  new_anchor: string | null;
  score: number;
  reason: string;
};

export class AnchorReanchorService {
  constructor(
    private readonly cacheService: IAnchorCacheService,
    private readonly nHopSearchService: NHopSearchService,
    private readonly getDb: () => Database.Database | null,
    private readonly getErrorLoggingService: () => ErrorLoggingService | null,
    private readonly getSlotConfig: (slot: AnchorSlot) => { hop_limit: number; vector_threshold: number }
  ) {}

  async calculateReanchorScore(
    memoryId: string,
    queryEmbedding?: number[],
    anchorEmbedding?: number[]
  ): Promise<number> {
    const db = this.getDb();
    if (!db) {
      return 0;
    }

    try {
      const memory = db.prepare(`
        SELECT 
          view_count,
          cite_count,
          edit_count,
          last_accessed,
          created_at,
          importance
        FROM memory_item
        WHERE id = ?
      `).get(memoryId) as {
        view_count: number;
        cite_count: number;
        edit_count: number;
        last_accessed: string | null;
        created_at: string;
        importance: number;
      } | undefined;

      if (!memory) {
        return 0;
      }

      const usageScore = Math.min(
        1.0,
        (Math.log(1 + memory.view_count) +
         2 * Math.log(1 + memory.cite_count) +
         0.5 * Math.log(1 + memory.edit_count)) / 10
      );

      let recencyScore = 0.5;
      if (memory.last_accessed) {
        const lastAccessed = new Date(memory.last_accessed);
        const now = new Date();
        const daysSinceAccess = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
        recencyScore = Math.max(0, 1.0 - daysSinceAccess / 30);
      }

      const importanceScore = memory.importance || 0.5;

      let semanticScore = 0.5;
      if (queryEmbedding) {
        const memoryEmbedding = await this.cacheService.getAnchorEmbedding(memoryId);
        if (memoryEmbedding?.embedding) {
          semanticScore = this.cosineSimilarity(queryEmbedding, memoryEmbedding.embedding);
        }
      }

      let anchorComparisonScore = 0.5;
      if (anchorEmbedding) {
        const memoryEmbedding = await this.cacheService.getAnchorEmbedding(memoryId);
        if (memoryEmbedding?.embedding) {
          anchorComparisonScore = 1.0 - this.cosineSimilarity(anchorEmbedding, memoryEmbedding.embedding);
        }
      }

      const finalScore =
        usageScore * 0.3 +
        recencyScore * 0.2 +
        importanceScore * 0.2 +
        semanticScore * 0.2 +
        anchorComparisonScore * 0.1;

      return Math.min(1.0, Math.max(0.0, finalScore));
    } catch (error) {
      logger.error('Reanchor score calculation failed', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  async analyzeAnchorUsage(
    agentId: string,
    slot: AnchorSlot,
    anchorMemoryId: string,
    anchorEmbedding: { embedding: number[]; provider: string },
    queryEmbedding?: number[]
  ): Promise<Array<{ memory_id: string; score: number; reason: string }>> {
    if (!this.getDb()) {
      const error = new DatabaseValidationError('Database is not set.');
      const errorLoggingService = this.getErrorLoggingService();
      if (errorLoggingService) {
        errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'getAnchorWithEmbedding',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    try {
      const slotConfig = this.getSlotConfig(slot);
      const nearbyMemories = await this.nHopSearchService.searchNHop(
        anchorEmbedding.embedding,
        anchorEmbedding.provider,
        anchorMemoryId,
        slotConfig.vector_threshold * 0.8,
        slotConfig.hop_limit,
        20,
        true
      );

      const candidates: Array<{ memory_id: string; score: number; reason: string }> = [];

      for (const memory of nearbyMemories) {
        const score = await this.calculateReanchorScore(
          memory.memory_id,
          queryEmbedding,
          anchorEmbedding.embedding
        );

        if (score > 0.5) {
          candidates.push({
            memory_id: memory.memory_id,
            score,
            reason: this.generateReanchorReason(memory, score)
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates;
    } catch (error) {
      logger.error('Anchor usage analysis failed', {
        agentId,
        slot,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async autoReanchor(
    agentId: string,
    slot: AnchorSlot,
    anchorManager: IAnchorManager,
    queryEmbedding?: number[],
    threshold: number = 0.7,
    strategy: 'gradual' | 'immediate' = 'gradual'
  ): Promise<AutoReanchorResult> {
    if (!this.getDb()) {
      const error = new Error('Database is not set.');
      const errorLoggingService = this.getErrorLoggingService();
      if (errorLoggingService) {
        errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'getAnchorWithEmbedding',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    try {
      const currentAnchor = await anchorManager.getAnchor(agentId, slot);
      if (!currentAnchor || Array.isArray(currentAnchor) || !currentAnchor.memory_id) {
        return {
          moved: false,
          old_anchor: null,
          new_anchor: null,
          score: 0,
          reason: '앵커가 설정되지 않았습니다'
        };
      }

      const anchorEmbedding = await this.cacheService.getAnchorEmbedding(currentAnchor.memory_id);
      if (!anchorEmbedding) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: 0,
          reason: '앵커 임베딩을 찾을 수 없습니다'
        };
      }

      const candidates = await this.analyzeAnchorUsage(
        agentId,
        slot,
        currentAnchor.memory_id,
        anchorEmbedding,
        queryEmbedding
      );

      if (candidates.length === 0 || !candidates[0] || candidates[0].score < threshold) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: candidates[0]?.score || 0,
          reason: `임계값(${threshold}) 미만 또는 후보 없음`
        };
      }

      const bestCandidate = candidates[0];
      if (!bestCandidate) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: 0,
          reason: '후보 없음'
        };
      }

      if (strategy === 'gradual') {
        if (slot === 'A') {
          const bAnchor = await anchorManager.getAnchor(agentId, 'B');
          if (bAnchor && !Array.isArray(bAnchor) && bAnchor.memory_id) {
            await anchorManager.setAnchor(agentId, bAnchor.memory_id, 'C');
          }
          await anchorManager.setAnchor(agentId, currentAnchor.memory_id, 'B');
        } else if (slot === 'B') {
          await anchorManager.setAnchor(agentId, currentAnchor.memory_id, 'C');
        }
        await anchorManager.setAnchor(agentId, bestCandidate.memory_id, slot);
      } else {
        await anchorManager.setAnchor(agentId, bestCandidate.memory_id, slot);
      }

      logger.info('Auto reanchor completed', {
        agentId,
        slot,
        oldAnchor: currentAnchor.memory_id,
        newAnchor: bestCandidate.memory_id,
        score: bestCandidate.score,
        reason: bestCandidate.reason
      });

      return {
        moved: true,
        old_anchor: currentAnchor.memory_id,
        new_anchor: bestCandidate.memory_id,
        score: bestCandidate.score,
        reason: bestCandidate.reason
      };
    } catch (error) {
      logger.error('Auto reanchor failed', {
        agentId,
        slot,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async checkAndAutoReanchor(
    agentId: string,
    slot: AnchorSlot,
    anchorManager: IAnchorManager,
    queryEmbedding?: number[],
    autoMoveEnabled: boolean = false
  ): Promise<AutoReanchorResult | null> {
    if (!autoMoveEnabled) {
      return null;
    }

    try {
      return await this.autoReanchor(agentId, slot, anchorManager, queryEmbedding, 0.7, 'gradual');
    } catch (error) {
      logger.debug('Auto reanchor check failed (ignored)', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      const error = new VectorDimensionMismatchError(a.length, b.length);
      const errorLoggingService = this.getErrorLoggingService();
      if (errorLoggingService) {
        errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'cosineSimilarity',
            vectorA_length: a.length,
            vectorB_length: b.length
          }
        );
      }
      throw error;
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

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private generateReanchorReason(
    memory: Pick<NHopSearchResult, 'memory_id' | 'content' | 'similarity' | 'hop_distance'>,
    score: number
  ): string {
    const reasons: string[] = [];

    if (score > 0.7) {
      reasons.push('높은 사용 빈도');
    }
    if (memory.similarity && memory.similarity > 0.8) {
      reasons.push('쿼리와 높은 유사도');
    }
    if (memory.hop_distance === 1) {
      reasons.push('앵커와 직접 연결');
    }

    return reasons.length > 0 ? reasons.join(', ') : '종합 점수 우수';
  }
}
