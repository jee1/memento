/** Wire names for search-quality extra_data. SQL and emit sites read this object. */
export const SEARCH_QUALITY_EXTRA_KEYS = {
  rejection_gate_verdict: 'rejection_gate_verdict',
  rejection_gate_top_score: 'rejection_gate_top_score',
  text_ms: 'text_ms',
  embedding_ms: 'embedding_ms',
  vector_ms: 'vector_ms',
  gate_ms: 'gate_ms',
  post_ms: 'post_ms',
} as const;
