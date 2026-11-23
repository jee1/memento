/**
 * 한 레인에만 잡힌 후보의 다른 레인 점수를 채운다. 텍스트 레인에만 잡힌 후보는 벡터 유사도를 (#1021),
 * 벡터 레인에만 잡힌 후보는 BM25 점수를 (#1814) 채운다.
 *
 * 벡터 레인의 후보 선정(HYBRID_VECTOR_THRESHOLD, prefetch 크기)은 건드리지 않는다.
 * 후보로 뽑지 않은 것과 유사도가 0인 것은 다르다 — 전자는 «측정하지 않음»이고,
 * 후자만 «측정했더니 0»이다. 융합 점수에는 후자만 들어가야 한다.
 */

import type Database from 'better-sqlite3';
import { getRankingWeights } from '../../../shared/config/ranking-weights-loader.js';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import { clamp01 } from '../../../shared/utils/clamp.js';
import { mapQueryScore } from '../../../shared/config/embedding-models.js';
import { loadCurrentNativeVectors, type CurrentNativeVector } from '../../../shared/utils/current-native-embedding.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';
import type { VectorSearchResult } from '../../embedding/index.js';
import { applyVectorLengthDecay } from './vector-length-decay.js';
import { buildFTSQuery } from './search-engine/search-engine-fts-query.js';
import { ftsRankToRelevance } from './search-engine/search-engine-ranking.js';
import { buildFtsRankForIdsStatement } from './search-engine/search-engine-sql-builder.js';
import { collectResultIds } from './hybrid-search-outcome-utils.js';
import { mcpLogger } from '../../../shared/utils/mcp-logger.js';

/** 벡터 레인이 실제로 사용한 질의 임베딩. provider 별로 하나씩. */
export interface HybridQueryEmbedding {
  provider: EmbeddingProvider;
  embedding: number[];
}

type TextRow = {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned?: number | boolean;
  tags?: string[];
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
};

function toTextRow(raw: unknown): TextRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Partial<TextRow>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  return row as TextRow;
}

/**
 * 텍스트 레인 후보 중 벡터 레인이 뽑지 않은 것들의 유사도를 계산해
 * VectorSearchResult 형태로 돌려준다. 호출자는 이것을 벡터 결과 배열 뒤에 붙이기만 하면 된다.
 *
 * 반환 항목은 전부 textResults 에 이미 있던 기억이므로 후보 집합이 커지지 않는다.
 * 임베딩이 없는 기억은 아예 반환하지 않는다 — 그러면 결합기가 기존대로 0 을 유지한다.
 */
export function backfillTextOnlyVectorResults(
  db: Database.Database,
  textResults: unknown[],
  vectorResults: VectorSearchResult[],
  queryEmbeddings: HybridQueryEmbedding[]
): VectorSearchResult[] {
  if (queryEmbeddings.length === 0 || textResults.length === 0) return [];

  const covered = new Set(vectorResults.map((result) => result.id));
  const pending = new Map<string, TextRow>();
  for (const raw of textResults) {
    const row = toTextRow(raw);
    if (row && !covered.has(row.id) && !pending.has(row.id)) {
      pending.set(row.id, row);
    }
  }
  if (pending.size === 0) return [];

  const ids = [...pending.keys()];
  const best = new Map<string, number>();

  for (const { provider, embedding } of queryEmbeddings) {
    if (embedding.length === 0) continue;
    let stored: Map<string, CurrentNativeVector>;
    try {
      // 텍스트 레인에서만 잡힌 후보는 native 코사인으로 잰다. 긴 기억은 KNN 레인도 [vector_window_blend] 로 native 쪽으로 당긴다 (#1827).
      // 질의 벡터와 같은 모델로 만든 native 행만 비교한다 (#1732). 차원이 같아도 모델이 다르면 공간이 다르다.
      stored = loadCurrentNativeVectors(db, ids, provider);
    } catch {
      // 스키마가 없는 환경(레거시/모킹)에서는 백필을 건너뛴다. 기존 동작 그대로 0 이 남는다.
      return [];
    }
    for (const [memoryId, vector] of stored) {
      if (vector.embedding.length !== embedding.length) continue;
      const similarity = mapQueryScore(provider, clamp01(cosineSimilarity(embedding, vector.embedding)));
      const previous = best.get(memoryId);
      if (previous === undefined || similarity > previous) {
        best.set(memoryId, similarity);
      }
    }
  }

  if (best.size === 0) return [];

  const entries: VectorSearchResult[] = [];
  for (const [id, similarity] of best) {
    const row = pending.get(id);
    if (!row) continue;
    entries.push({
      id: row.id,
      content: row.content,
      type: row.type,
      importance: row.importance,
      created_at: row.created_at,
      pinned: Boolean(row.pinned),
      similarity,
      ...(row.last_accessed !== undefined ? { last_accessed: row.last_accessed } : {}),
      ...(row.tags !== undefined ? { tags: row.tags } : {}),
      ...(row.project_id !== undefined ? { project_id: row.project_id } : {}),
      ...(row.owner_id !== undefined ? { owner_id: row.owner_id } : {}),
      ...(row.process_id !== undefined ? { process_id: row.process_id } : {}),
      ...(row.session_id !== undefined ? { session_id: row.session_id } : {}),
    });
  }

  // 벡터 레인과 같은 길이 감쇠(#921)를 적용해야 두 경로의 점수가 비교 가능해진다.
  return applyVectorLengthDecay(entries, getRankingWeights().vector_length_decay);
}

/**
 * 벡터 레인에만 잡힌 후보 중 텍스트 레인과 같은 FTS5 질의에 걸리는 것의 BM25 점수를 채운다 (#1814).
 * 텍스트 레인은 상위 N행만 돌려주므로 BM25 순위가 낮은 벡터 1위는 텍스트 몫을 통째로 잃었다.
 *
 * 걸리지 않은 후보는 반환하지 않는다. 결합기가 textScore 0 을 유지하며, 여기서 0 은 «측정했더니 불일치»다.
 * 점수는 텍스트 레인과 같은 ftsRankToRelevance 이고, FTS5 bm25 는 코퍼스 전체 통계를 쓰므로 같은 행이면 같은 값이다.
 */
export function backfillVectorOnlyTextResults(
  db: Database.Database,
  query: string,
  textResults: unknown[],
  vectorResults: VectorSearchResult[]
): Array<TextRow & { score: number }> {
  const covered = new Set(collectResultIds(textResults as Array<{ id?: unknown }>));
  const pending = new Map<string, VectorSearchResult>();
  for (const result of vectorResults) {
    if (!covered.has(result.id) && !pending.has(result.id)) pending.set(result.id, result);
  }
  if (pending.size === 0) return [];

  const ftsQuery = buildFTSQuery(query);
  if (ftsQuery === '""' || ftsQuery.length === 0) return [];

  const ids = [...pending.keys()];
  let rows: Array<{ id: string; fts_rank: number }>;
  try {
    const { sql, params } = buildFtsRankForIdsStatement(ftsQuery, ids);
    rows = db.prepare(sql).all(...params) as Array<{ id: string; fts_rank: number }>;
  } catch (error) {
    // FTS 테이블이 없는 환경(레거시/모킹)에서는 건너뛴다. 기존대로 textScore 0 이 남는다.
    // 운영에서 매번 실패하면 #1814 이전 순위로 조용히 돌아가므로 원인을 남긴다.
    mcpLogger.logServer('warn', '벡터 전용 후보 BM25 백필 실패, 건너뜀', {
      error: error instanceof Error ? error.message : String(error),
      candidates: ids.length,
    });
    return [];
  }

  const entries: Array<TextRow & { score: number }> = [];
  for (const { id, fts_rank } of rows) {
    const score = ftsRankToRelevance(fts_rank);
    const v = pending.get(id);
    if (score === null || !v) continue;
    entries.push({
      id: v.id,
      content: v.content,
      type: v.type,
      importance: v.importance,
      created_at: v.created_at,
      pinned: Boolean(v.pinned),
      score,
      ...(v.last_accessed !== undefined ? { last_accessed: v.last_accessed } : {}),
      ...(v.tags !== undefined ? { tags: v.tags } : {}),
      ...(v.project_id !== undefined ? { project_id: v.project_id } : {}),
      ...(v.owner_id !== undefined ? { owner_id: v.owner_id } : {}),
      ...(v.process_id !== undefined ? { process_id: v.process_id } : {}),
      ...(v.session_id !== undefined ? { session_id: v.session_id } : {}),
    });
  }
  return entries;
}
