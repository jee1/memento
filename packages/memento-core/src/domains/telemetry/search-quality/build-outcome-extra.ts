import type { HybridLaneMs } from '../../search/algorithms/hybrid-search-types.js';
import { SEARCH_QUALITY_EXTRA_KEYS } from './extra-keys.js';

type OutcomeSearchResult = {
  stage_ms?: HybridLaneMs;
  query_time?: number;
};

/**
 * Stage keys for selected and empty events.
 * Hybrid `query_time` covers the whole search, so it is not used when `stage_ms` is present.
 * FTS-only results have `query_time` and no `stage_ms`. That wider interval is stored as `text_ms`.
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
