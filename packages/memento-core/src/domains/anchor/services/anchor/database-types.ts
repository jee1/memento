

/**
 * 앵커 정보 쿼리 결과
 */
export interface AnchorInfoRow {
  memory_id: string | null;
  agent_id?: string;
  slot?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * 데이터베이스 쿼리 결과 (단일 행)
 */
export type QueryResult<T> = T | undefined;

