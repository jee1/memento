/**
 * 검색 품질 지표 계산 공통 헬퍼
 * Precision@K, Recall@K, NDCG@K 계산 로직 공유
 */

export interface SearchResult {
  id: string;
  score?: number;
  finalScore?: number;
  relevance?: number; // 관련성 점수 (0-1)
}

export interface GroundTruth {
  queryId: string;
  relevantIds: string[]; // 관련 결과 ID 목록
}

/**
 * Precision@K 계산
 * 상위 K개 결과 중 관련 결과 비율
 * 
 * @param results 검색 결과 (점수 순으로 정렬된 상태)
 * @param relevantIds 관련 결과 ID 목록
 * @param k 상위 K개
 * @returns Precision@K (0-1)
 */
export function calculatePrecisionAtK(
  results: SearchResult[],
  relevantIds: string[],
  k: number
): number {
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;

  const relevantSet = new Set(relevantIds);
  const relevantCount = topK.filter(r => relevantSet.has(r.id)).length;

  return relevantCount / topK.length;
}

/**
 * Recall@K 계산
 * 관련 결과 중 상위 K개에 포함된 비율
 * 
 * @param results 검색 결과 (점수 순으로 정렬된 상태)
 * @param relevantIds 관련 결과 ID 목록
 * @param k 상위 K개
 * @returns Recall@K (0-1)
 */
export function calculateRecallAtK(
  results: SearchResult[],
  relevantIds: string[],
  k: number
): number {
  if (relevantIds.length === 0) return 0;

  const topK = results.slice(0, k);
  const relevantSet = new Set(relevantIds);
  const relevantInTopK = topK.filter(r => relevantSet.has(r.id)).length;

  return relevantInTopK / relevantIds.length;
}

/**
 * DCG (Discounted Cumulative Gain) 계산
 * 
 * @param results 검색 결과
 * @param relevantIds 관련 결과 ID 목록
 * @param k 상위 K개
 * @returns DCG@K
 */
function calculateDCG(
  results: SearchResult[],
  relevantIds: string[],
  k: number
): number {
  const topK = results.slice(0, k);
  const relevantSet = new Set(relevantIds);
  let dcg = 0;

  topK.forEach((result, index) => {
    const position = index + 1;
    const relevance = relevantSet.has(result.id) ? 1 : 0;
    
    // DCG 공식: relevance / log2(position + 1)
    dcg += relevance / Math.log2(position + 1);
  });

  return dcg;
}

/**
 * IDCG (Ideal DCG) 계산
 * 이상적인 순서로 정렬된 경우의 DCG
 * 
 * @param relevantIds 관련 결과 ID 목록
 * @param k 상위 K개
 * @returns IDCG@K
 */
function calculateIDCG(relevantIds: string[], k: number): number {
  const idealRelevance = Array(Math.min(relevantIds.length, k)).fill(1);
  let idcg = 0;

  idealRelevance.forEach((relevance, index) => {
    const position = index + 1;
    idcg += relevance / Math.log2(position + 1);
  });

  return idcg;
}

/**
 * NDCG@K (Normalized Discounted Cumulative Gain) 계산
 * 정규화된 할인 누적 이득
 * 
 * @param results 검색 결과 (점수 순으로 정렬된 상태)
 * @param relevantIds 관련 결과 ID 목록
 * @param k 상위 K개
 * @returns NDCG@K (0-1)
 */
export function calculateNDCGAtK(
  results: SearchResult[],
  relevantIds: string[],
  k: number
): number {
  if (relevantIds.length === 0) return 0;

  const dcg = calculateDCG(results, relevantIds, k);
  const idcg = calculateIDCG(relevantIds, k);

  if (idcg === 0) return 0;

  return dcg / idcg;
}
