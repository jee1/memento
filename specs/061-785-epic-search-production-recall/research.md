# Research: Epic #785 production recall

**Date**: 2026-08-16
**Spec**: [spec.md](./spec.md)

## Decision 1 — Diagnose before tuning

**Choice**: Funnel + FTS/BM25 + fusion correctness first. No global ranking-weight retune until those land.

**Why**: 899/1536 zero-hit. Conditional recall given any-hit ≈ 0.919. Gold that never entered the candidate set cannot be recovered by α/β retuning. Token packing is computed after Recall@10, so budget is not the gap cause.

**Rejected**: Immediate TOML weight search, corpus-specific boosts, new reranker.

## Decision 2 — Reuse HybridSearchEngine internals for funnel

**Choice**: Persist per-query stage counts already known to the engine (`text_count` / `vector_count` / `union_count` / `reranked_count`) plus gold-hit flags. Do not add a new telemetry framework.

**Why**: Engine already emits funnel-ish counts; production adapter currently keeps only final IDs + latency (#786). Telemetry SQL already json_extracts `text_candidate_count` / `vector_candidate_count` / `union_candidate_count`.

**Rejected**: New tracing SDK, storing full document bodies per query.

## Decision 3 — FTS5 rank contract

**Choice**: Treat SQLite FTS5 `rank`/BM25 as “lower is better”, including negatives. Invert/convert for relevance while preserving order. Stop assuming `ftsRank > 0`.

**Why**: `ORDER BY fts_rank DESC` plus `ftsRank > 0` in `search-engine-ranking.ts` drops the real BM25 signal and reverses order.

**Rejected**: Custom parser, query expansion, stopword tables specialized to LoCoMo.

## Decision 4 — Preserve combiner weighted score

**Choice**: Final relevance for overlap = combiner’s `textScore * textWeight + vectorScore * vectorWeight`. Ranker must not replace relevance with `vectorScore || textScore`.

**Why**: Combiner already computes the contract; `HybridResultRanker.buildBaseFeatures` overwrites it. Helper in `vector-search-quality-metrics/report-comparison.ts` copies the same `||` bug and must stay consistent.

**Rejected**: Cross-encoder, RRF as production default (RRF-sim remains a comparison arm only).

## Decision 5 — Vector policy after fusion restore

**Choice**: Keep `HYBRID_VECTOR_THRESHOLD = 0.38` as funnel diagnostic. Fetch at threshold 0. Fill ranking pool from raw prefetch when thresholded count `< query.limit`. Prefetch multiplier stays 2. Record threshold, prefetch, and fill flag in ranking hash. See `vector-threshold-ablation.md`.

**Why**: `HYBRID_VECTOR_THRESHOLD = 0.38` and `VECTOR_SEARCH_LIMIT_MULTIPLIER = 2` are provider-agnostic. Production tfidf is hashed 512-d; baseline sparse TF-IDF is a different score family. LoCoMo scopes have ≤32 sessions.

**Rejected**: New embedding model, deleting tfidf, baking LoCoMo DF into production.

## Decision 6 — Two named retrieval strategies

**Choice**: Keep direct `hybridSearchEngine.search` as an explicit engine strategy; add a separate actual `memory_injection` / knowledge-context strategy. Do not silently replace `memento_prod` metrics.

**Why**: Injection applies scoped candidate multiplier, default weights, summary, max_memories, token selection. #737 noted injection does not return ranked IDs; that is why the adapter called search() directly. Parity requires provenance, not renaming.

**Rejected**: Treating engine Recall@10 as user-facing quality. Official LoCoMo QA evaluator as the primary gate.

## Reproduction notes

- Baseline four (grep/fts_only/vector/rrf_sim) are deterministic.
- Production quality metrics match across sequential runs; concurrent benches jitter (~0.367–0.387 Recall@10). Compare only solo runs.
- `reproduction.git_sha` must be the commit that contains LoCoMo adapter code, not a parent.
- Ranking label `default` is insufficient; store `ranking-sha256:…` from `getRankingVersion()`.
- LoCoMo CC BY-NC 4.0: originals stay in `.local/locomo/`; CI uses `locomo-shape-sample.json`.
