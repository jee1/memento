# Fusion comparison (#788 / T022)

**Date**: 2026-08-16  
**Status**: weighted combiner relevance restored in production path. No ranking-weights.toml retune. LoCoMo numbers deferred (CI has no corpus).

## Variants

| Variant | What it is | This slice |
|---------|------------|------------|
| current (pre-#788) | ranker relevance = `vectorScore \|\| textScore` | removed |
| weighted-preserved | relevance = `textScore * textWeight + vectorScore * vectorWeight` | **shipped** |
| RRF-sim | existing `rrf_sim` baseline in agent-memory benchmark | unchanged, still a separate baseline |

## Synthetic CI

Overlap fixture in `hybrid-result-ranker.spec.ts`: text-heavy (0.9/0.2) vs vector-heavy (0.2/0.9) at textWeight 0.7 ranks lexical first after the fix; pre-fix ranked semantic first. Adaptive-weight engine test flips top hit when weights swap 0.9/0.1 ↔ 0.1/0.9.

## Local LoCoMo (optional)

After acquiring `.local/locomo/`, compare `memento_prod` Recall@10 / MRR / nDCG / p95 for weighted-preserved vs a branch that still uses `||`. Record category deltas here before any weight retune (#789 is next).
