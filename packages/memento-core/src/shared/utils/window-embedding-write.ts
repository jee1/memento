/**
 * MiniLM 윈도 임베딩 쓰기 (#1112)
 *
 * native 행(윈도 평균)은 그대로 두고, 윈도가 2개 이상인 문서만 윈도별 행을 추가한다.
 * 단일 윈도 문서는 meanPoolNormalize([v]) === v 라서 native 행이 곧 윈도 벡터다(추가 행 없음).
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from './database.js';
import {
  computeL2Norm,
  encodeFloat32Embedding,
  shouldNormalizeFlag,
} from './embedding-serialization.js';
import { replaceMemoryEmbedding } from './memory-embedding-write.js';

export const WINDOW_PROJECTION_PREFIX = 'window:';

/** MiniLMEmbeddingService.MAX_WINDOWS 와 동기화된 값 */
export const MAX_WINDOW_ROWS = 16;

/**
 * 윈도 행을 만들 후보로 볼 최소 본문 길이 (#1112).
 * 이보다 짧은 문서는 단일 윈도라 native 행이 곧 윈도 벡터다.
 */
export const WINDOW_CANDIDATE_MIN_CHARS = 800;

export function buildWindowProjectionType(index: number): string {
  return `${WINDOW_PROJECTION_PREFIX}${index}`;
}

export const WINDOW_PROJECTION_TYPES: readonly string[] = Array.from(
  { length: MAX_WINDOW_ROWS },
  (_, index) => buildWindowProjectionType(index)
);

export function isWindowProjectionType(value: string): boolean {
  return value.startsWith(WINDOW_PROJECTION_PREFIX);
}

export async function deleteWindowEmbeddings(
  db: Database.Database,
  memoryId: string,
  provider: string
): Promise<void> {
  await DatabaseUtils.run(
    db,
    `DELETE FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? AND projection_type LIKE 'window:%'`,
    [memoryId, provider]
  );
}

export async function replaceWindowEmbeddings(
  db: Database.Database,
  row: {
    memoryId: string;
    provider: string;
    model: string | undefined;
    vectors: number[][];
  }
): Promise<void> {
  await deleteWindowEmbeddings(db, row.memoryId, row.provider);

  if (row.vectors.length < 2) {
    return;
  }

  const vectors = row.vectors.slice(0, MAX_WINDOW_ROWS);
  for (let i = 0; i < vectors.length; i++) {
    const vector = vectors[i]!;
    await replaceMemoryEmbedding(db, {
      memoryId: row.memoryId,
      provider: row.provider,
      projectionType: buildWindowProjectionType(i),
      embedding: encodeFloat32Embedding(vector),
      dim: vector.length,
      model: row.model,
      dimensions: vector.length,
      normalized: shouldNormalizeFlag(computeL2Norm(vector)),
      createdBy: 'memory_embedding_service',
    });
  }
}
