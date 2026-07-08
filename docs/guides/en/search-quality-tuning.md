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

The harness splits into **compare → tune → report**. Use `quality:benchmark:compare-profiles` to A/B two profile files, `quality:benchmark:tune-weights` to search candidate weights, and `quality:benchmark:tune-report` to read a tuning run summary. See the Korean guide for full command examples and flags.
