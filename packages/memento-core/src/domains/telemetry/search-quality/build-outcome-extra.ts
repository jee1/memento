import type { HybridLaneMs } from '../../search/index.js';
import { SEARCH_QUALITY_EXTRA_KEYS } from './extra-keys.js';

type OutcomeSearchResult = {
  stage_ms?: HybridLaneMs;
  query_time?: number;
};

/**
 * selected/empty extra의 단계 ms.
 * `text_ms`는 hybrid면 텍스트 레인만, FTS-only면 `SearchEngine.search` 전체(`query_time`)다.
 * p50·p95는 `retrieval_strategy`로 거른 뒤 낼 것. (#1386)
 */
export function recallOutcomeStageExtra(
  searchResult: OutcomeSearchResult | null | undefined,
  postMs: number,
): Record<string, number> {
  const extra: Record<string, number> = {};
  const stage = searchResult?.stage_ms;
  if (stage) {
    extra[SEARCH_QUALITY_EXTRA_KEYS.text_ms] = stage.text_ms;
    if (stage.embedding_ms !== undefined) {
      extra[SEARCH_QUALITY_EXTRA_KEYS.embedding_ms] = stage.embedding_ms;
    }
    if (stage.vector_ms !== undefined) {
      extra[SEARCH_QUALITY_EXTRA_KEYS.vector_ms] = stage.vector_ms;
    }
    if (stage.gate_ms !== undefined) {
      extra[SEARCH_QUALITY_EXTRA_KEYS.gate_ms] = stage.gate_ms;
    }
  } else if (typeof searchResult?.query_time === 'number') {
    extra[SEARCH_QUALITY_EXTRA_KEYS.text_ms] = searchResult.query_time;
  }
  extra[SEARCH_QUALITY_EXTRA_KEYS.post_ms] = postMs;
  return extra;
}
