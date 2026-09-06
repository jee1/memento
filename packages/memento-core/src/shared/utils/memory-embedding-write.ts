/**
 * memory_embedding 쓰기 단일 경로
 *
 * `INSERT OR REPLACE`를 쓰면 안 된다. SQLite의 REPLACE가 유발한 삭제는
 * `PRAGMA recursive_triggers`가 켜져 있을 때만 DELETE 트리거를 실행하는데,
 * 기본값은 꺼짐이다. 그래서 `memory_embedding_vec_delete`가 돌지 않고,
 * 옛 행의 id를 rowid로 갖는 vec0 행이 그대로 남는다. 새 INSERT는 새 id를 받으므로
 * vec 인덱스에 아무도 참조하지 않는 벡터가 쌓인다.
 *
 * 고아 벡터는 결과로 나오지는 않는다(JOIN에서 떨어진다). 대신 KNN의 LIMIT 예산을
 * 먼저 소진해서, 인덱스 절반이 고아면 실제 후보의 절반이 조용히 사라진다.
 * #889 재색인 직후 memory_item_vec_minilm이 8213행이어야 하는데 16417행이었다.
 *
 * UPSERT는 이 문제가 없다. 행의 id가 유지되고 `memory_embedding_vec_update`가
 * 그 id의 vec 행만 지웠다 다시 넣는다. 문장 하나라 트랜잭션도 필요 없다.
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from './database.js';

export interface MemoryEmbeddingWrite {
  memoryId: string;
  provider: string;
  projectionType: string;
  embedding: Buffer;
  /** 투영 전 원본 차원 */
  dim: number;
  model: string | undefined;
  /** 실제로 저장되는 차원 */
  dimensions: number;
  normalized: boolean | number;
  createdBy: string;
}

const UPSERT_SQL = `
  INSERT INTO memory_embedding (
    memory_id,
    embedding_provider,
    projection_type,
    embedding,
    dim,
    model,
    dimensions,
    precision,
    normalized,
    version,
    created_by,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(memory_id, embedding_provider, projection_type) DO UPDATE SET
    embedding = excluded.embedding,
    dim = excluded.dim,
    model = excluded.model,
    dimensions = excluded.dimensions,
    precision = excluded.precision,
    normalized = excluded.normalized,
    version = excluded.version,
    created_by = excluded.created_by,
    created_at = CURRENT_TIMESTAMP
`;

/** UNIQUE(memory_id, embedding_provider, projection_type) 한 행을 교체한다. */
export async function replaceMemoryEmbedding(
  db: Database.Database,
  row: MemoryEmbeddingWrite
): Promise<void> {
  await DatabaseUtils.run(db, UPSERT_SQL, [
    row.memoryId,
    row.provider,
    row.projectionType,
    row.embedding,
    row.dim,
    row.model,
    row.dimensions,
    32,
    row.normalized,
    1,
    row.createdBy
  ]);
}
