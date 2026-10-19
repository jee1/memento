/**
 * 검색 결과 랭킹·점수 breakdown
 */

import { getRankingWeights } from '../../../../shared/config/ranking-weights-loader.js';
import type { MemorySearchResult } from '../../../../shared/types/search.types.js';
import type { ScoreBreakdown } from '../../../../shared/types/search.types.js';
import { DAY_MS } from '../../../../shared/utils/date.js';
import { sigmoidNormalizedNet } from '../../../memory/repositories/feedback-repository.interface.js';
import { SearchRanking, type SearchFeatures } from '../search-ranking.js';
import type { SearchEngineRow } from './search-engine.types.js';

function attachBreakdownToDisplayTotal(bd: ScoreBreakdown, displayTotal: number): ScoreBreakdown {
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

function calculateFactMetadataBoost(numTimes: number, lastMentionedAt: Date | null): number {
  const logFactor = Math.log(1 + Math.max(0, numTimes));
  const recencyFactor = lastMentionedAt
    ? 1 / (1 + (Date.now() - lastMentionedAt.getTime()) / (30 * DAY_MS))
    : 1;
  const boost = 1 + 0.1 * logFactor * recencyFactor;
  return Math.min(boost, 1.2);
}

/**
 * SQLite FTS5 `rank` (bm25) is lower-is-better and typically negative.
 * `0` is the empty-query / LIKE-fallback sentinel — treat it as “no BM25”.
 * Sigmoid maps signed rank onto (0, 1) while preserving order.
 * T defaults to fts_relevance.temperature; T=1 saturates the real rank range (#1079).
 */
export function ftsRankToRelevance(ftsRank: number, temperature?: number): number | null {
  if (!Number.isFinite(ftsRank) || ftsRank === 0) {
    return null;
  }
  const t = temperature ?? getRankingWeights().fts_relevance.temperature;
  return 1 / (1 + Math.exp(ftsRank / t));
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

interface ScoredRow {
  relevance: number;
  recency: number;
  importance: number;
  baseFeatures: SearchFeatures;
  /** BM25 레인이면 sigmoid relevance, 아니면 null */
  bm25Relevance: number | null;
  factBoost: number;
  finalScore: number;
}

type RankingOpts = { includeBreakdown?: boolean; feedbackNetByMemory?: Map<string, number> };

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

const parseTags = (row: SearchEngineRow): string[] => {
  if (typeof row.tags !== 'string' || !row.tags) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(row.tags);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

/** `selectedContents` 는 앞선 행들의 content. duplication penalty 가 이 순서에 의존한다. */
function scoreRow(
  ranking: SearchRanking,
  row: SearchEngineRow,
  ctx: { query: string; tags: string[]; temperature: number; selectedContents: string[]; opts?: RankingOpts }
): ScoredRow {
  const ftsRank = typeof row.fts_rank === 'number' ? row.fts_rank : Number(row.fts_rank ?? 0);
  const bm25Relevance = ftsRankToRelevance(ftsRank, ctx.temperature);
  const relevance =
    bm25Relevance ?? ranking.calculateRelevance({ query: ctx.query, content: row.content, tags: ctx.tags });
  const recency = ranking.calculateRecency(toDate(row.created_at));
  const importance = ranking.calculateImportance(row.importance, Boolean(row.pinned), row.type);

  const baseFeatures: SearchFeatures = {
    relevance,
    recency,
    importance,
    usage: ranking.calculateUsage({ viewCount: 1, citeCount: 0, editCount: 0 }),
    duplication_penalty: ranking.calculateDuplicationPenalty(row.content, ctx.selectedContents),
    feedback_score: sigmoidNormalizedNet(ctx.opts?.feedbackNetByMemory?.get(row.id) ?? 0),
  };

  const baseScore = ranking.calculateFinalScore(baseFeatures);
  const preBoost = bm25Relevance !== null ? relevance * 0.7 + baseScore * 0.3 : baseScore;
  const factBoost = calculateFactMetadataBoost(
    row.num_times != null ? Number(row.num_times) : 1,
    row.last_mentioned_at ? new Date(row.last_mentioned_at) : null
  );
  return { relevance, recency, importance, baseFeatures, bm25Relevance, factBoost, finalScore: preBoost * factBoost };
}

/** null·undefined 가 아니면 복사 */
const NON_NULL_FIELDS = [
  'task_goal', 'steps', 'reflection_notes', 'workflow_name', 'skill_name', 'trigger_conditions', 'version'
] as const;
/** undefined 가 아니면 복사 (null 도 그대로 전달) */
const DEFINED_FIELDS = ['version_series_id', 'owner_id', 'process_id', 'session_id', 'project_id'] as const;

function buildSearchResult(row: SearchEngineRow, tags: string[], scored: ScoredRow): MemorySearchResult {
  const result: MemorySearchResult = {
    id: row.id,
    content: row.content,
    type: row.type as MemorySearchResult['type'],
    importance: row.importance,
    created_at: toDate(row.created_at),
    last_accessed: row.last_accessed == null ? undefined : toDate(row.last_accessed),
    pinned: Boolean(row.pinned),
    tags,
    score: scored.finalScore,
    recall_reason: generateRecallReason(
      scored.relevance,
      scored.recency,
      scored.importance,
      scored.finalScore,
      scored.bm25Relevance !== null
    ),
  };
  const target = result as unknown as Record<string, unknown>;
  for (const key of NON_NULL_FIELDS) if (row[key] != null) target[key] = row[key];
  for (const key of DEFINED_FIELDS) if (row[key] !== undefined) target[key] = row[key];
  if (row.num_times != null) result.num_times = Number(row.num_times);
  if (row.last_mentioned_at != null) result.last_mentioned_at = toDate(row.last_mentioned_at);
  return result;
}

/**
 * 표시 점수(finalScore)에 맞춰 breakdown 각 항을 스케일한다.
 * BM25: (항 × 0.3 [+ relevance × 0.7]) × factBoost, 아니면 항 × factBoost.
 * 곱셈 순서는 `(score * weight) * factBoost` — `x * 1` 은 x 와 비트 단위로 같다.
 */
function scaleBreakdown(bd: ScoreBreakdown, scored: ScoredRow): ScoreBreakdown {
  const { bm25Relevance, factBoost, finalScore } = scored;
  const weight = bm25Relevance === null ? 1 : 0.3;
  const scale = (c: { score: number }) => ({ score: c.score * weight * factBoost, pct: 0 });
  const relevanceScore =
    bm25Relevance === null
      ? bd.relevance.score * factBoost
      : (bd.relevance.score * 0.3 + scored.relevance * 0.7) * factBoost;
  return {
    relevance: { score: relevanceScore, pct: 0 },
    recency: scale(bd.recency),
    importance: scale(bd.importance),
    usage: scale(bd.usage),
    feedback: scale(bd.feedback),
    duplication_penalty: scale(bd.duplication_penalty),
    total: finalScore
  };
}

export function applyRanking(
  ranking: SearchRanking,
  results: SearchEngineRow[],
  query: string,
  opts?: RankingOpts
): MemorySearchResult[] {
  const selectedContents: string[] = [];
  const temperature = getRankingWeights().fts_relevance.temperature;

  return results
    .map((row) => {
      const tags = parseTags(row);
      const scored = scoreRow(ranking, row, { query, tags, temperature, selectedContents, opts });
      selectedContents.push(row.content);

      const result = buildSearchResult(row, tags, scored);
      if (opts?.includeBreakdown) {
        const bd = ranking.calculateFinalScoreAndBreakdown(scored.baseFeatures, { includeBreakdown: true });
        if (bd.breakdown) {
          result.score_breakdown = attachBreakdownToDisplayTotal(scaleBreakdown(bd.breakdown, scored), scored.finalScore);
        }
      }
      return result;
    })
    .sort((a, b) => b.score - a.score);
}
