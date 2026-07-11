import type {
  SearchFilters,
  RecallCallOptions,
  SearchResult,
  HybridSearchParams,
  HybridSearchResult,
} from '../types.js';
import type { MementoClientCore } from './client-context.js';

/**
 * 기억 검색
 *
 * `feedback()`에 넘길 `score_breakdown`을 얻으려면 `recallOptions`에
 * `{ include_metadata: true, include_score_breakdown: true }`를 지정한다(서버 계약).
 */
export async function recall(
  client: MementoClientCore,
  query: string,
  filters?: SearchFilters,
  limit?: number,
  recallOptions?: RecallCallOptions,
): Promise<SearchResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/recall', {
    query,
    filters,
    limit,
    ...recallOptions,
  });

  const result = response.data.result;

  if (result.items && result.items.items && Array.isArray(result.items.items)) {
    return {
      ...result,
      items: result.items.items,
      total_count: result.items.total_count || result.items.items.length,
      query_time: result.items.query_time || 0,
    };
  }

  return result;
}

/**
 * 하이브리드 검색
 */
export async function hybridSearch(
  client: MementoClientCore,
  params: HybridSearchParams,
): Promise<HybridSearchResult> {
  client.ensureConnected();

  const recallExtras: RecallCallOptions = {
    include_metadata: params.include_metadata,
    include_score_breakdown: params.include_score_breakdown,
  };
  if (params.vectorWeight !== undefined) {
    recallExtras.vector_weight = params.vectorWeight;
  }
  if (params.textWeight !== undefined) {
    recallExtras.text_weight = params.textWeight;
  }
  const searchResult = await recall(client, params.query, params.filters, params.limit, recallExtras);

  return {
    items: searchResult.items.map(item => ({
      ...item,
      textScore: item.score || 0,
      vectorScore: 0,
      finalScore: item.score || 0,
    })),
    total_count: searchResult.total_count,
    query_time: searchResult.query_time,
    search_type: 'hybrid',
  };
}
