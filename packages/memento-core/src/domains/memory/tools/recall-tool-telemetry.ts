/**
 * Recall MCP 텔레메트리·쿼리 상관 필드 — recall-tool.ts에서 분리 (013 유지보수)
 */

import { mementoConfig } from '../../../shared/config/index.js';
import type { EmbeddingProvider } from '../../../shared/types/index.js';

/** 파일 내부 전용 — 공개 패키지 API로 노출하지 않음 */
type RecallRetrievalStrategyTelemetry = 'hybrid' | 'vector' | 'fts' | 'graph';

/** 텔레메트리 retrieval_strategy — recall 메인 경로는 hybrid·fts·vector 가중 조합만 사용 */
export function recallTelemetryRetrievalStrategy(
  useHybridRecall: boolean,
  normalizedVectorWeight: number,
  normalizedTextWeight: number
): RecallRetrievalStrategyTelemetry {
  if (!useHybridRecall) return 'fts';
  const eps = 1e-9;
  if (normalizedTextWeight <= eps && normalizedVectorWeight > eps) return 'vector';
  if (normalizedVectorWeight <= eps && normalizedTextWeight > eps) return 'fts';
  return 'hybrid';
}

export function recallSearchRequestedExtra(
  queryHash: string,
  query: string,
  retrievalStrategy: RecallRetrievalStrategyTelemetry
): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    query_hash: queryHash,
    retrieval_strategy: retrievalStrategy,
    embedding_provider: mementoConfig.embeddingProvider,
    ranking_version: 'ranking-weights-default-v1'
  };
  if (mementoConfig.telemetryStoreQueryPlaintext) {
    extra.query = query;
  }
  return extra;
}

/** 후속 search.empty / search.selected 이벤트에서 요청과 상관시키기 위한 최소 필드 */
export function recallQueryCorrelationExtra(queryHash: string, query: string): Record<string, unknown> {
  const e: Record<string, unknown> = { query_hash: queryHash };
  if (mementoConfig.telemetryStoreQueryPlaintext) {
    e.query = query;
  }
  return e;
}

/** 하이브리드 검색 query_embedding_providers → metadata용 단일 canonical + 배열 */
export function buildQueryEmbeddingMetadataFields(providers: EmbeddingProvider[]): {
  embedding_provider: string;
  query_embedding_providers: EmbeddingProvider[];
} {
  const uniqueSorted: EmbeddingProvider[] = [...new Set(providers)].sort();
  const cfg = mementoConfig.embeddingProvider as EmbeddingProvider | undefined;
  const embedding_provider: string =
    uniqueSorted.length === 1
      ? uniqueSorted[0]!
      : cfg !== undefined && uniqueSorted.includes(cfg)
        ? cfg
        : uniqueSorted[0]!;
  return { embedding_provider, query_embedding_providers: uniqueSorted };
}
