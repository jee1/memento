# Search quality tuning guide

Memento’s recall score blends relevance, recency, importance, usage, relations, feedback, and duplication penalties. When weights are off, good memories sink or stale ones float to the top. This guide explains the **autoresearch harness**: benchmark fixtures, ranking profiles under `config/ranking-profiles/`, and the npm scripts that compare and tune weights.

For the full walkthrough (Korean), see [search-quality-tuning.md (KO)](../ko/search-quality-tuning.md). Ranking formula details: [search-ranking.md](../../agents/search-ranking.md).

## Prerequisites

Build `@memento/core` before running tuning scripts:

```bash
npm run build -w @memento/core
```

Benchmark data lives under `tests/fixtures/search-quality/benchmark-v3/`.

## Three scripts

The harness splits into **compare → tune → report**. Use `npm run quality -- benchmark compare-profiles` to A/B two profile files, `npm run quality -- benchmark tune-weights` to search candidate weights, and `npm run quality -- benchmark tune-report` to read a tuning run summary. See the Korean guide for full command examples and flags.

## tune-weights knobs, split and tie gate

`tune-weights` builds each candidate as a full ranking config from the baseline and moves only the selected knobs. `--baseline-profile` takes a profile name or a path to a `.toml` file (absolute or relative to cwd). `--knobs a,b,c` selects the knobs to move (default: all; an unknown key is an error; unselected knobs keep the baseline value).

| Knob | Sampling | Bounds |
|------|----------|--------|
| `ranking_weights.alpha`, `beta`, `gamma`, `delta`, `epsilon`, `theta`, `zeta_fb` | baseline x U[0.8, 1.2] | 0 to 1 (clamped) |
| `relevance_signal.scale` | uniform | 0.5 to 3.0 |
| `recency_signal.scale` | uniform | 0.05 to 1 |
| `importance_signal.scale` | uniform | 0.05 to 1 |
| `fts_relevance.temperature` | uniform | 2 to 30 |
| `vector_length_decay.characteristic_length` | uniform | 10 to 120 |
| `vector_length_decay.saturation_length` | uniform | 20 to 300 (never below `characteristic_length`) |

**Explore/judge split.** Queries are stratified by the macro categories in `category-mapping.json` (queries without a mapping form an `unmapped` stratum). Each stratum is shuffled with a seed derived from `--seed`; the first ceil(n/2) go to explore, the rest to judge. The composite score, the NDCG gate and best-candidate selection use explore queries only. Judge queries are used once, to compare the single best candidate with the baseline (paired permutation test on MRR, NDCG@10, Recall@10). `summary.json` records `seed`, `knobs`, `split.explore_query_ids`, `split.judge_query_ids`, `split.strata`, `baseline_tie_rate`, `best_knobs`, and a `candidates[]` array with each candidate's knobs, gate result and reject reason. benchmark-v3 has 29 queries, so the judge half (14) has weak statistical power.

**Relevance tie gate.** A high `relevance_signal.scale` saturates the relevance component and creates ties between relevant results inside the top 10, so relevance stops ordering them and recency and importance decide the rank (#1180). `finalScore` ties stay at 0 even at scale 3.0 because other terms break them, so the gate reads `score_breakdown.relevance.score` instead and counts top-10 pairs whose scores differ by less than 1e-9. A candidate is rejected (reason contains `tie`) when its tie rate exceeds `baseline_tie_rate + 0.005`. Measured pair rates on benchmark-v3: 0 at scale 1.0, 0.0008 at 2.0, 0.0031 at 2.25, 0.0084 at 2.5, 0.036 at 3.0. The metric uses no relevance labels, so computing it over all queries leaks nothing from the judge set.
