# FTS query combinator ablation (#787 / T014)

**Date**: 2026-08-16  
**Status**: deferred — BM25 contract restored first; combinator unchanged.

## Current semantics (`search-engine-fts-query.ts`)

| Condition | Combinator |
|-----------|------------|
| token count ≤ `HYBRID_SEARCH.FTS_OR_ABOVE_TOKEN_COUNT` (5) | implicit AND (space-separated) |
| token count > 5 | first `HYBRID_SEARCH.FTS_MAX_TOKENS_FOR_OR` (8) tokens joined with `OR` |

No all-token OR path exists today.

## Why not pick a new combinator in this slice

CI does not ship LoCoMo (CC BY-NC 4.0 — originals stay in `.local/locomo/`). Changing AND/OR without a scorecard would confound the #787 BM25 delta against #786 funnel baseline.

Candidates to measure locally after BM25 lands:

1. short AND / long first-8 OR (current)
2. always AND
3. all-token OR (no 8-token cap)

Pick the variant that improves zero-hit and `sql_candidate_recall` without blowing p95. Record numbers here before changing constants.

**Follow-up**: Combinator ablation for short AND → OR + prefix* is tracked in [#807](https://github.com/jee1/memento/issues/807) / `specs/660-807-fts-or-prefix/fts-query-ablation.md`.
