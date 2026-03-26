import type { EmbeddingProvider } from '../types/embedding.types.js';
import { mementoConfig } from '../config/index.js';

const TFIDF_QUERY_EMBEDDING_STDERR_INTRO =
  '⚠️ [Memento] 이번 검색의 쿼리 임베딩에 TF-IDF가 사용되었습니다.';
const TFIDF_QUERY_EMBEDDING_STDERR_TAIL =
  ' sqlite-vec 유사도 fallback이거나, 다중 provider VEC 검색에서 고차원 임베딩 대신 TF-IDF로 생성된 경우 의미 기반 검색 품질이 저하될 수 있습니다.\n';

/**
 * sqlite-vec fallback·VEC 런타임 후 유사도 fallback, 또는 sqlite-vec를 쓰는 VEC 경로에서
 * 고차원 provider 요청이 TF-IDF 쿼리 임베딩으로 바뀐 경우(tfidf_query_embedding_fallback)에 한해,
 * 이번 쿼리 임베딩에 실제로 tfidf가 쓰인 경우에만 stderr 경고.
 * (vec 인덱스 없이도 MiniLM/OpenAI 등으로 쿼리 임베딩이 생성되면 경고하지 않음)
 * `mementoConfig.embeddingProvider === 'tfidf'`(의도적 TF-IDF 전용)이라도,
 * 명시적으로 다른 provider를 요청했다가 TF-IDF로 강등된 경우는 경고함.
 * include_metadata와 무관하게 호출해야 함 (SC-002).
 *
 * @param tfidfQueryEmbeddingFallbackProviders — TF-IDF로 바뀐 **요청** provider(다중 VEC 태스크·fallback 휴리스틱)
 */
export function emitTfidfFallbackWarningIfNeeded(
  _fallbackUsed: boolean | undefined,
  queryEmbeddingProviders: EmbeddingProvider[] | undefined,
  /** VEC 다중 provider 검색에서 요청 provider≠tfidf인데 실제 쿼리 임베딩이 tfidf로 생성된 경우 */
  tfidfQueryEmbeddingFallback?: boolean,
  tfidfQueryEmbeddingFallbackProviders?: EmbeddingProvider[]
): void {
  if (process.env.MEMENTO_CLI_QUIET === '1') {
    return;
  }
  const requested = (tfidfQueryEmbeddingFallbackProviders ?? []).filter(p => p && p !== 'tfidf');
  const uniqueRequested = [...new Set(requested)].sort();
  if (mementoConfig.embeddingProvider === 'tfidf' && uniqueRequested.length === 0) {
    return;
  }
  if (!queryEmbeddingProviders?.includes('tfidf')) {
    return;
  }
  // 의도적 TF-IDF-only 요청(provider_filter=['tfidf'])에서는 fallbackUsed가 true일 수 있어도
  // tfidfQueryEmbeddingFallback이 설정되지 않으므로 경고를 억제한다.
  if (tfidfQueryEmbeddingFallback !== true) {
    return;
  }
  const requestedPart =
    uniqueRequested.length > 0
      ? ` TF-IDF로 대체된 요청 provider: ${uniqueRequested.join(', ')}.`
      : '';
  process.stderr.write(
    TFIDF_QUERY_EMBEDDING_STDERR_INTRO + requestedPart + TFIDF_QUERY_EMBEDDING_STDERR_TAIL
  );
}
