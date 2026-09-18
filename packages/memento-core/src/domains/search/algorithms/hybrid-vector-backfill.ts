/**
 * 텍스트 레인에만 잡힌 후보의 벡터 유사도를 저장된 임베딩으로 채운다 (#1021).
 *
 * 벡터 레인의 후보 선정(HYBRID_VECTOR_THRESHOLD, prefetch 크기)은 건드리지 않는다.
 * 후보로 뽑지 않은 것과 유사도가 0인 것은 다르다 — 전자는 «측정하지 않음»이고,
 * 후자만 «측정했더니 0»이다. 융합 점수에는 후자만 들어가야 한다.
 */

import type Database from 'better-sqlite3';
import { getRankingWeights } from '../../../shared/config/ranking-weights-loader.js';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import { clamp01 } from '../../../shared/utils/clamp.js';
import { embeddingColumnToNumbers } from '../../../shared/utils/embedding-serialization.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';
import type { VectorSearchResult } from '../../memory/services/memory-embedding-service.js';
import { applyVectorLengthDecay } from './vector-length-decay.js';

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
  const placeholders = ids.map(() => '?').join(', ');
  const best = new Map<string, number>();

  for (const { provider, embedding } of queryEmbeddings) {
    if (embedding.length === 0) continue;
    let rows: Array<{ memory_id: string; embedding: unknown }>;
    try {
      rows = db
        .prepare(
          'SELECT memory_id, embedding FROM memory_embedding ' +
            `WHERE embedding_provider = ? AND projection_type = 'native' AND memory_id IN (${placeholders})`
        )
        .all(provider, ...ids) as Array<{ memory_id: string; embedding: unknown }>;
    } catch {
      // 스키마가 없는 환경(레거시/모킹)에서는 백필을 건너뛴다. 기존 동작 그대로 0 이 남는다.
      return [];
    }
    for (const row of rows) {
      const stored = embeddingColumnToNumbers(row.embedding);
      if (!stored || stored.length !== embedding.length) continue;
      const similarity = clamp01(cosineSimilarity(embedding, stored));
      const previous = best.get(row.memory_id);
      if (previous === undefined || similarity > previous) {
        best.set(row.memory_id, similarity);
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
