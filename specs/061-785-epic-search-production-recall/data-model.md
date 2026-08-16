# Data Model: Epic #785 production recall artifacts

**Spec**: [spec.md](./spec.md)
**Storage**: JSON scorecard artifacts only. No SQLite schema migration.

## FunnelStage (per query)

| Field | Type | Meaning |
|-------|------|---------|
| `name` | enum | `raw_text` \| `text_topN` \| `raw_vector` \| `thresholded_vector` \| `union` \| `final_top10` \| `context` |
| `candidate_count` | int ≥ 0 | IDs present at this stage |
| `gold_any` | bool | ≥1 gold ID present |
| `gold_all` | bool | all gold IDs present |
| `gold_fraction` | 0..1 | \|gold ∩ stage\| / \|gold\| |

Stage order is fixed. `context` exists only on the injection strategy.

## QueryFunnelRecord

| Field | Type |
|-------|------|
| `query_id` | string |
| `category` | string \| null |
| `gold_ids` | string[] |
| `stages` | FunnelStage[] |
| `engine_ids` | string[] |
| `injection_ids` | string[] \| omitted |
| `latency_ms` | number |

Backward compatible: existing per-query ranked IDs / failed_queries remain.

## ReproductionBlock

| Field | Type | Notes |
|-------|------|-------|
| `git_sha` | hex | `git rev-parse HEAD` of the running tree, not parent |
| `fixture_sha256` | hex64 | |
| `evaluator_revision` | string | adapter/benchmark version |
| `eligible_query_ids_sha256` | hex64 | |
| `excluded_query_ids_sha256` | hex64 | adversarial/empty-evidence |
| `ranking_version` | `ranking-sha256:[a-f0-9]{12}` | not the label `default` |
| `ranking_weights_path_override` | bool | `MEMENTO_RANKING_WEIGHTS_PATH` set? |
| `embedding_provider` | string | |
| `fallback_reason` | string \| null | |
| `vector_threshold` | number | |
| `vector_prefetch` | number | |
| `text_weight` | number | |
| `vector_weight` | number | |

Existing `ranking_profile` may remain as a human label. Gate consumers prefer `ranking_version`.

## StrategyScorecard

| Strategy | `production_path` | What it measures |
|----------|-------------------|------------------|
| engine (keeps `memento_prod` key unless Q4 overrides) | `hybridSearchEngine.search` | primitive top-k IDs |
| injection | `memory_injection` | selected context IDs + serialized tokens |

Shared quality fields (compat): `recall@5`, `recall@10`, `mrr`, `ndcg@10`, `p50`, `p95`, `query_count`, `abstention_count`, `failed_queries`.

Added: `zero_hit_rate`, `recall_any`, `recall_all`, `funnel` aggregates (mean/p50/p95 candidate_count, `<10 results` rate) by strategy and category.

Injection-only: `requested_token_budget`, `serialized_token_count`, `fixed_token_evidence_coverage`.

## QualityGate

| Field | Pass |
|-------|------|
| `recall_at_10` | ≥ 0.80 |
| `zero_hit_rate` | < 0.20 |
| `p95_ms` | < 1000 |
| `category_regression` | no eligible category worse than recorded pre-fix baseline beyond existing `production_vs_fts` policy |

Engine vs injection gates MUST be labeled separately so a passing engine run cannot hide a failing injection run.

## Relationships

```text
ReproductionBlock 1──* StrategyScorecard
StrategyScorecard 1──* QueryFunnelRecord
QueryFunnelRecord 1──* FunnelStage
QualityGate ──refers── StrategyScorecard
```

No new MCP tool fields required. Ranking order of existing recall/injection results may change (correctness restore).
