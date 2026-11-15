/**
 * 저장 벡터를 직접 읽는 경로의 단일 규칙 (#1731, #1732).
 *
 * 벡터 검색(#889)과 같다. native 행만 읽고, 모델을 거르는 provider 는 지금 모델로 만든 행만 쓴다.
 * 창 행(#1112)은 기억 전체가 아니라 조각의 벡터라 기억 하나를 대표하지 못하고,
 * 재색인 전의 옛 모델 행은 지금 모델 인덱스와 벡터 공간이 다르다.
 */
import type Database from 'better-sqlite3';
import { getEmbeddingModelFilter } from '../config/embedding-models.js';
import { embeddingColumnToNumbers } from './embedding-serialization.js';

export interface CurrentNativeVector {
  embedding: number[];
  provider: string;
}

interface NativeRow {
  memory_id: string;
  embedding: unknown;
  embedding_provider: string | null;
  model: string | null;
}

function isCurrentModel(row: NativeRow): boolean {
  const expected = getEmbeddingModelFilter(row.embedding_provider ?? undefined);
  return expected === null || row.model === expected;
}

/**
 * 기억마다 쓸 수 있는 native 벡터 하나. provider 를 주면 그 provider 행만 본다.
 * 쓸 수 있는 행이 없는 기억(임베딩 없음, 옛 모델 행뿐)은 결과에 없다.
 */
export function loadCurrentNativeVectors(
  db: Database.Database,
  memoryIds: readonly string[],
  provider?: string
): Map<string, CurrentNativeVector> {
  const out = new Map<string, CurrentNativeVector>();
  if (memoryIds.length === 0) return out;

  const placeholders = memoryIds.map(() => '?').join(', ');
  const providerSql = provider ? ' AND embedding_provider = ?' : '';
  const rows = db.prepare(
    `SELECT memory_id, embedding, embedding_provider, model
     FROM memory_embedding
     WHERE memory_id IN (${placeholders}) AND projection_type = 'native'${providerSql}
     ORDER BY memory_id, created_at DESC, id DESC`
  ).all(...memoryIds, ...(provider ? [provider] : [])) as NativeRow[];

  for (const row of rows) {
    if (out.has(row.memory_id) || !isCurrentModel(row)) continue;
    const embedding = embeddingColumnToNumbers(row.embedding);
    if (embedding) {
      out.set(row.memory_id, { embedding, provider: row.embedding_provider || 'tfidf' });
    }
  }
  return out;
}

export function loadCurrentNativeVector(
  db: Database.Database,
  memoryId: string,
  provider?: string
): CurrentNativeVector | null {
  return loadCurrentNativeVectors(db, [memoryId], provider).get(memoryId) ?? null;
}
