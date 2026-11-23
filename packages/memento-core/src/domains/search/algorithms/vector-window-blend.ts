/**
 * Window-to-native blend for long memories (#1827).
 *
 * KNN scores a windowed memory by its closest window (#1112 max-sim). A long memory whose
 * single query-dense window sits among unrelated windows then ties or beats a short memory
 * that is about the query as a whole. Pulling the best-window cosine toward the memory's
 * native (window-mean) cosine reflects how much of the memory is on topic.
 */

import type Database from 'better-sqlite3';
import { loadCurrentNativeVectors } from '../../../shared/utils/current-native-embedding.js';
import { WINDOW_PROJECTION_PREFIX } from '../../../shared/utils/window-embedding-write.js';
import { getEmbeddingModelFilter } from '../../../shared/config/embedding-models.js';
import { clamp01 } from '../../../shared/utils/clamp.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';

interface VectorWindowBlendOptions {
  enabled: boolean;
  lambda: number;
  min_windows: number;
}

/** maxWin − λ·(maxWin − native). A native at or above the window score leaves it unchanged. */
function blendWindowSimilarity(windowSimilarity: number, nativeSimilarity: number, lambda: number): number {
  if (nativeSimilarity >= windowSimilarity) return windowSimilarity;
  return windowSimilarity - lambda * (windowSimilarity - nativeSimilarity);
}

function countWindows(db: Database.Database, memoryIds: string[], provider: string): Map<string, number> {
  const placeholders = memoryIds.map(() => '?').join(', ');
  // KNN 과 loadCurrentNativeVectors 처럼 지금 모델의 창만 센다.
  const model = getEmbeddingModelFilter(provider);
  const modelSql = model ? ' AND model = ?' : '';
  const rows = db.prepare(
    `SELECT memory_id, COUNT(*) AS n FROM memory_embedding
     WHERE embedding_provider = ? AND projection_type LIKE ?${modelSql} AND memory_id IN (${placeholders})
     GROUP BY memory_id`
  ).all(provider, `${WINDOW_PROJECTION_PREFIX}%`, ...(model ? [model] : []), ...memoryIds) as Array<{ memory_id: string; n: number }>;
  return new Map(rows.map((row) => [row.memory_id, row.n]));
}

/**
 * Blend raw (pre-mapping) cosine similarities. Memories below `min_windows`, without a current
 * native row, or searched by a provider with no query vector keep their score.
 * When disabled, returns the same array reference.
 */
export function applyVectorWindowBlend<T extends { id: string; similarity: number; provider: string }>(
  db: Database.Database,
  results: T[],
  queryEmbeddings: ReadonlyMap<string, number[]>,
  options: VectorWindowBlendOptions
): T[] {
  if (!options.enabled || options.lambda <= 0 || results.length === 0) {
    return results;
  }
  const blended = new Map<T, number>();
  for (const provider of new Set(results.map((r) => r.provider))) {
    const query = queryEmbeddings.get(provider);
    if (!query) continue;
    const rows = results.filter((r) => r.provider === provider);
    let longRows: T[];
    let natives: ReturnType<typeof loadCurrentNativeVectors>;
    try {
      const windows = countWindows(db, rows.map((r) => r.id), provider);
      longRows = rows.filter((r) => (windows.get(r.id) ?? 0) >= options.min_windows);
      if (longRows.length === 0) continue;
      natives = loadCurrentNativeVectors(db, longRows.map((r) => r.id), provider);
    } catch {
      // 스키마가 없는 환경(레거시/모킹)에서는 이 provider 를 섞지 않는다.
      continue;
    }
    for (const row of longRows) {
      const native = natives.get(row.id);
      if (!native || native.embedding.length !== query.length) continue;
      const nativeSimilarity = clamp01(cosineSimilarity(query, native.embedding));
      blended.set(row, blendWindowSimilarity(row.similarity, nativeSimilarity, options.lambda));
    }
  }
  if (blended.size === 0) return results;
  return results.map((r) => {
    const similarity = blended.get(r);
    return similarity === undefined ? r : { ...r, similarity };
  });
}
