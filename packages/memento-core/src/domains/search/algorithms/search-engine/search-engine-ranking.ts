/**
 * 검색 결과 랭킹·점수 breakdown
 */

import { mementoConfig } from '../../../../shared/config/index.js';
import type { MemorySearchResult } from '../../../../shared/types/index.js';
import type { ScoreBreakdown } from '../../../../shared/types/search.types.js';
import { sigmoidNormalizedNet } from '../../../memory/repositories/feedback-repository.js';
import { SearchRanking, type SearchFeatures } from '../search-ranking.js';
import type { SearchEngineRow } from './search-engine.types.js';

export function attachBreakdownToDisplayTotal(bd: ScoreBreakdown, displayTotal: number): ScoreBreakdown {
  const denom = Math.abs(displayTotal) < 1e-12 ? 1e-12 : Math.abs(displayTotal);
  const map = (c: { score: number; pct: number }) => ({
    score: c.score,
    pct: Math.round((100 * c.score) / denom),
  });
  return {
    relevance: map(bd.relevance),
    recency: map(bd.recency),
    importance: map(bd.importance),
    usage: map(bd.usage),
    feedback: map(bd.feedback),
    duplication_penalty: map(bd.duplication_penalty),
    total: displayTotal
  };
}

export function calculateFactMetadataBoost(numTimes: number, lastMentionedAt: Date | null): number {
  const logFactor = Math.log(1 + Math.max(0, numTimes));
  const recencyFactor = lastMentionedAt
    ? 1 / (1 + (Date.now() - lastMentionedAt.getTime()) / (30 * 24 * 60 * 60 * 1000))
    : 1;
  const boost = 1 + 0.1 * logFactor * recencyFactor;
  return Math.min(boost, 1.2);
}

export function generateRecallReason(
  relevance: number,
  recency: number,
  importance: number,
  finalScore: number,
  isFTS: boolean = false
): string {
  const reasons: string[] = [];

  if (isFTS) {
    reasons.push('FTS5 전문 검색');
  }
  if (relevance > 0.7) {
    reasons.push('높은 관련성');
  }
  if (recency > 0.8) {
    reasons.push('최근 생성');
  }
  if (importance > 0.8) {
    reasons.push('높은 중요도');
  }
  if (finalScore > 0.9) {
    reasons.push('종합 점수 우수');
  }

  return reasons.length > 0 ? reasons.join(', ') : '일반 검색 결과';
}

export function applyRanking(
  ranking: SearchRanking,
  results: SearchEngineRow[],
  query: string,
  opts?: { includeBreakdown?: boolean; feedbackNetByMemory?: Map<string, number> }
): MemorySearchResult[] {
  const selectedContents: string[] = [];

  return results
    .map((row) => {
      const ftsRank = typeof row.fts_rank === 'number' ? row.fts_rank : Number(row.fts_rank ?? 0);
      const relevance = ftsRank > 0 ?
        Math.min(ftsRank / 100, 1.0) :
        ranking.calculateRelevance({
          query,
          content: row.content,
          tags: typeof row.tags === 'string' ? (JSON.parse(row.tags) as string[]) : []
        });

      const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
      const recency = ranking.calculateRecency(createdAt, row.type);

      const importance = ranking.calculateImportance(
        row.importance,
        Boolean(row.pinned),
        row.type
      );

      const usage = ranking.calculateUsage({
        viewCount: 1,
        citeCount: 0,
        editCount: 0
      });

      const duplicationPenalty = ranking.calculateDuplicationPenalty(
        row.content,
        selectedContents
      );

      const net = opts?.feedbackNetByMemory?.get(row.id);
      const feedback_score = sigmoidNormalizedNet(net ?? 0);

      const consolidationScore = row.consolidation_score !== null && row.consolidation_score !== undefined
        ? Number(row.consolidation_score)
        : undefined;

      const useConsolidationPath =
        mementoConfig.consolidationScoreEnabled && consolidationScore !== undefined;

      const baseFeatures: SearchFeatures = ftsRank > 0
        ? {
            relevance: 0.3,
            recency,
            importance,
            usage,
            duplication_penalty: duplicationPenalty,
            feedback_score,
            ...(useConsolidationPath && consolidationScore !== undefined
              ? { consolidation_score: consolidationScore }
              : {})
          }
        : {
            relevance,
            recency,
            importance,
            usage,
            duplication_penalty: duplicationPenalty,
            feedback_score,
            ...(useConsolidationPath && consolidationScore !== undefined
              ? { consolidation_score: consolidationScore }
              : {})
          };

      const baseScore = ranking.calculateFinalScore(baseFeatures);
      const preBoost = ftsRank > 0 ? ftsRank * 0.7 + baseScore * 0.3 : baseScore;

      const factBoost = calculateFactMetadataBoost(
        row.num_times != null ? Number(row.num_times) : 1,
        row.last_mentioned_at ? new Date(row.last_mentioned_at) : null
      );
      const finalScore = preBoost * factBoost;

      selectedContents.push(row.content);

      const lastAccessed =
        row.last_accessed == null
          ? undefined
          : row.last_accessed instanceof Date
            ? row.last_accessed
            : new Date(row.last_accessed);

      const result: MemorySearchResult = {
        id: row.id,
        content: row.content,
        type: row.type as MemorySearchResult['type'],
        importance: row.importance,
        created_at: createdAt,
        last_accessed: lastAccessed,
        pinned: Boolean(row.pinned),
        tags: typeof row.tags === 'string' ? (JSON.parse(row.tags) as string[]) : [],
        score: finalScore,
        recall_reason: generateRecallReason(relevance, recency, importance, finalScore, ftsRank > 0),
      };
      if (row.task_goal != null) result.task_goal = row.task_goal;
      if (row.steps != null) result.steps = row.steps;
      if (row.reflection_notes != null) result.reflection_notes = row.reflection_notes;
      if (row.workflow_name != null) result.workflow_name = row.workflow_name;
      if (row.skill_name != null) result.skill_name = row.skill_name;
      if (row.trigger_conditions != null) result.trigger_conditions = row.trigger_conditions;
      if (row.version !== undefined && row.version !== null) result.version = row.version;
      if (row.version_series_id !== undefined) result.version_series_id = row.version_series_id;
      if (row.owner_id !== undefined) result.owner_id = row.owner_id;
      if (row.process_id !== undefined) result.process_id = row.process_id;
      if (row.session_id !== undefined) result.session_id = row.session_id;
      if (row.project_id !== undefined) result.project_id = row.project_id;
      if (row.num_times != null) result.num_times = Number(row.num_times);
      if (row.last_mentioned_at != null) {
        result.last_mentioned_at =
          row.last_mentioned_at instanceof Date
            ? row.last_mentioned_at
            : new Date(row.last_mentioned_at);
      }

      if (mementoConfig.consolidationScoreEnabled && consolidationScore !== undefined) {
        result.consolidation_score = consolidationScore;
      }

      if (opts?.includeBreakdown) {
        const bd = ranking.calculateFinalScoreAndBreakdown(baseFeatures, {
          includeBreakdown: true
        });
        if (bd.breakdown) {
          const ftsPart = ftsRank > 0 ? ftsRank * 0.7 : 0;
          const scaled: ScoreBreakdown =
            ftsRank > 0
              ? {
                  relevance: {
                    score: (bd.breakdown.relevance.score * 0.3 + ftsPart) * factBoost,
                    pct: 0
                  },
                  recency: { score: bd.breakdown.recency.score * 0.3 * factBoost, pct: 0 },
                  importance: { score: bd.breakdown.importance.score * 0.3 * factBoost, pct: 0 },
                  usage: { score: bd.breakdown.usage.score * 0.3 * factBoost, pct: 0 },
                  feedback: { score: bd.breakdown.feedback.score * 0.3 * factBoost, pct: 0 },
                  duplication_penalty: {
                    score: bd.breakdown.duplication_penalty.score * 0.3 * factBoost,
                    pct: 0
                  },
                  total: finalScore
                }
              : {
                  relevance: { score: bd.breakdown.relevance.score * factBoost, pct: 0 },
                  recency: { score: bd.breakdown.recency.score * factBoost, pct: 0 },
                  importance: { score: bd.breakdown.importance.score * factBoost, pct: 0 },
                  usage: { score: bd.breakdown.usage.score * factBoost, pct: 0 },
                  feedback: { score: bd.breakdown.feedback.score * factBoost, pct: 0 },
                  duplication_penalty: {
                    score: bd.breakdown.duplication_penalty.score * factBoost,
                    pct: 0
                  },
                  total: finalScore
                };
          result.score_breakdown = attachBreakdownToDisplayTotal(scaled, finalScore);
        }
      }

      return result;
    })
    .sort((a, b) => b.score - a.score);
}
