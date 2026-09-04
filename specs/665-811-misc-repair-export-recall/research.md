# Research: #811 misc repair / filter / -32603

**Date**: 2026-09-05

## R1 — Repair export failure

**Finding**: `packages/memento-core/dist/index.js` absent in this worktree; `src/index.ts` exports `buildTripleSentence` and `hasBrokenTripleConjugation`. Script imports from `@memento/core` package `exports["."]` → `dist/index.js`.

**Decision**: Treat as build/stale-dist; add export smoke so CI fails if exports regress. Keep script (OQ-1).

## R2 — Injection budget starvation

**Finding**: `searchLimitMultiplier` is `2` or `6` then JS post-filter. Issue observed large broken populations emptying shortlist after filter.

**Decision**: Adaptive expand until `maxMemories` clean items or cap; keep post-filter as DiD; do not rely on content SQL LIKE (OQ-3).

## R3 — -32603 mapping

**Finding**: `RecallInputValidationError` (name set) and remember `throw new Error('type 파라미터는 필수…')`. `mapToolExecutionErrorToJsonRpc` only maps `ZodError` → `-32602`; else dispatch → `-32603`.

**Decision**: Shared `ToolInputValidationError` + mapper; no Zod required `type` (OQ-2).

## R4 — Backtick remember

**Finding**: One-off comment; type-param path already explains many -32603s.

**Decision**: Attempt minimal repro; unreproduced → non-blocking (OQ-5).

## R5 — Hybrid similarity

**Finding**: `vector-search-hybrid-query.ts` selects `COALESCE(1 - distance, 0) as vector_similarity`; `mapHybridResults` only `clamp01`. Violates #806 FR-020 residual.

**Decision**: Return distance; convert in mapper with `cosineDistanceToSimilarity`; SQL may still use `1-d` inside ORDER BY for ranking efficiency with comment (OQ-4 include).
