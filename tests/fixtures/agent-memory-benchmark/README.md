# Agent Memory Benchmark Fixture

This corpus is synthetic and authored for Memento issue #455.

- License: MIT
- Redistribution: allowed
- External source material: none
- Secrets/credentials: reviewed; no live values
- Purpose: deterministic CI coverage for coding-agent memory retrieval, E2E evidence injection, and graph-RRF gates

`longmemeval-s-sample.jsonl` documents the legacy adapter input shape.
`longmemeval-s-official-shape.json` is an independently authored, two-question
fixture matching the official cleaned JSON schema. Neither file copies
LongMemEval content.

`longmemeval-judge-results.jsonl` documents the task-completion judge result
protocol with synthetic values.

## Baselines (#737)

- `rrf_sim` — offline in-memory FTS + TF-IDF reciprocal rank fusion (synthetic)
- `memento_prod` — disposable DB + production RecallTool / HybridSearchEngine path (`npm run quality:agent-memory:production`)
