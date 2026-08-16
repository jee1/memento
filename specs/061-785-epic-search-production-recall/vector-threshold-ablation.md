# Vector threshold ablation (#789 / T025–T027)

**Date**: 2026-08-16  
**Status**: synthetic policy shipped; LoCoMo gold/non-gold deferred (CI has no corpus).

## Chosen policy

| Knob | Value | Why |
|------|-------|-----|
| diagnostic filter | `HYBRID_VECTOR_THRESHOLD = 0.38` | Keep as funnel `thresholded_vector`; do not guess a new number without LoCoMo |
| fetch | `threshold: 0` | Prefetch pool must exist so fill can recover below-threshold gold |
| prefetch | `limit * 2`, cap 100 (prefetch 20 at limit 10) | Same multiplier; 32/60 not selected without scorecard |
| under-fill | `VECTOR_UNDERFILL_FILL = true` | When thresholded count `< query.limit`, append remaining raw hits by similarity desc, skip duplicate ids |
| ranking pool | filled set, then existing min-max | Funnel `raw_ids` = prefetch; `thresholded_ids` = strict `>= 0.38` |
| min-max | **on** | Off would change fusion input scale; not measured on LoCoMo |
| embedding | hashed TF-IDF 512-d unchanged | Sparse TF-IDF is a different score family; no new model |

`getRankingVersion()` hashes `hybrid_vector_threshold`, `vector_prefetch_multiplier`, and `vector_underfill_fill` with the TOML weights.

## Synthetic filter table (hashed scores)

Fixture `{ high: 0.9, edge: 0.38, mid: 0.2, low: 0.05 }`:

| Threshold | Kept | Dropped |
|-----------|------|---------|
| 0 | high, edge, mid, low | — |
| 0.2 | high, edge, mid | low |
| 0.38 | high, edge | mid, low |

Fill at minCount 4 from 0.38-thresholded → `high, edge, mid, low`. Already-full minCount 2 → no extras.

## Prefetch 20 / 32 / 60

Not run on LoCoMo. Raising prefetch without a lower fetch threshold does not help: gold still dies at 0.38. Fill uses the existing prefetch 20 pool; larger prefetch is a local follow-up after `.local/locomo/` scorecard (zero-hit vs p95).

## Hashed vs sparse (T027)

Production hybrid TF-IDF is hashed 512-d cosine. Sparse TF-IDF BM25/lexical is the text channel, not a drop-in vector threshold. Do not compare those scores to pick 0.38. Min-max stays on so filled below-threshold hits still sit on the same 0–1 scale as `>= 0.38` hits.

## Local LoCoMo (optional)

After acquiring `.local/locomo/`, record provider raw similarity for gold vs non-gold, then threshold×prefetch Recall@10 / zero-hit / p95. Change 0.38 or the multiplier only if that table beats fill+0.38 without breaking p95 < 1s.
