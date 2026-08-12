# Implementation Plan: Production Recall Benchmark & Scorecard

**Branch**: `worktree-issue-737-production-recall-benchmark`  
**Spec**: `specs/057-737-production-recall-benchmark/spec.md`  
**Issue**: #737

## Architecture

```text
agent-memory-benchmark.ts
  ├─ evaluateBaselines()          → grep / fts_only / vector / rrf_sim [/ graph_rrf]
  └─ (opt) runProductionBaseline()
        └─ agent-memory-production-adapter.ts
              createMementoCore(tempDb)
              INSERT memory_item (fixed ids) + createAndStoreEmbedding
              hybridSearchEngine.search per query
              close + rm temp dir
  └─ buildProductionScorecard() + evaluateProductionVsFtsGate()
```

Production path reuses the same `HybridSearchEngine` that `RecallTool` and `memory_injection` → `buildKnowledgeContextBundle` call. Ranked IDs come from `search().items` (memory_injection response lacks ID list).

## Module boundaries

| Module | Role |
|--------|------|
| `scripts/agent-memory-production-adapter.ts` | Temp DB import + HybridSearch ranking |
| `scripts/agent-memory-benchmark.ts` | Rename `memento`→`rrf_sim`; wire production + scorecard |
| `scripts/agent-memory-*.spec.ts` | Unit/integration proofs |
| `package.json` | `quality:agent-memory:production` script (optional) |

## Data flow

1. Load dataset (fixture or LongMemEval adapter) — unchanged.
2. Synthetic baselines sync (rrf_sim).
3. If `production`: import docs → embed (prefer `tfidf`) → search each query with `limit=top_k`, optional `project_id`/`scopeId` filter via filters if mapped.
4. Evaluate metrics with existing `evaluateRankedResults` / `evaluateEndToEnd`.
5. Emit scorecard + `gates.production_vs_fts`.

## Config / env

- No new required env. Offline embedding via existing provider stack.
- Ranking profile label: `default` (from `config/ranking-profiles/default.toml` name).

## Test strategy

1. Rename assertions (`rrf_sim`).
2. Production adapter: import + search returns fixture-relevant IDs for ≥1 query.
3. Spy/stub proof that `hybridSearchEngine.search` is invoked.
4. Gate unit tests (pass/fail thresholds).
5. Scorecard schema fields present.
6. `npm run quality:agent-memory:test`; type-check; lint; graphify rebuild.

## Risks

- Full LongMemEval import is heavy — CI uses small fixture only.
- Embedding provider availability: fall back to text-only hybrid still exercises production text path; record provider in scorecard.
- `memory_item` TEXT PK + FTS triggers: rely on `initializeDatabase` schema.
