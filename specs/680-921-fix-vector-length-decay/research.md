# Research: Vector length decay (#921)

## Decision 1 — Formula

**Choice**: `factor = len / (len + k)` with `k = characteristic_length` (default 40).

**Rationale**: Issue requires continuous monotone (not step). `#903` length–score table is smooth and steep below ~40 chars. At len=21, k=40 → ≈0.34; len=663 → ≈0.94 — enough to invert the reported 0.749/0.722 ordering if applied to raw cosine.

**Alternatives rejected**:
- Hard create-time gate (≥40 chars) — broke 60 pipeline tests (#903).
- Centering / hubness — measured worse (#903).
- Piecewise steps — arbitrary boundaries kill nearby valid short facts.
- `1-exp(-len/τ)` — similar shape; rational form is simpler and matches common BM25-style length priors.

## Decision 2 — Apply site

**Choice**: Multiply `similarity` on hybrid vector results **before** `filterByVectorThreshold` / under-fill in `hybrid-vector-search-executor.ts` (both paths).

**Rationale**: Issue call sites; threshold must see effective scores (FR/Q3). `VectorSearchResult.content` is already present. Keep `filterByVectorThreshold` pure.

**Alternatives rejected**:
- Only in final ranker relevance slot — short docs still pass threshold and crowd fusion pool.
- Inside `cosineDistanceToSimilarity` — couples absolute cosine contract (#806/#811) to length policy.
- SQL-side — harder to configure/test; content length already in JS result.

## Decision 3 — Configuration

**Choice**: `config/ranking-weights.toml` section `[vector_length_decay]` with `enabled` + `characteristic_length`; include in `getRankingVersionPayload`.

**Rationale**: Issue points at loader ~198 for experimentability; ranking version already hashes hybrid vector knobs.

## Decision 4 — Default `k` and quality gate

**Provisional default**: `k=40` from #903 cliff (20–40 band).

**Validation (2026-09-07 session)**:

Synthetic issue scores (`len/(len+40)`):

| id | raw | after |
|----|-----|-------|
| short21 | 0.749 | 0.258 |
| short22 | 0.734 | 0.260 |
| long663 | 0.722 | 0.681 |

Order becomes long ≫ shorts (SC-001 fixture).

`VITEST_INCLUDE_NIGHTLY=1 npm run test:vector-search-quality` → 31/31 pass but env lacked usable MiniLM (`model is not a function`) and vec tables — **not a meaningful before/after for long-doc quality**. Residual: re-run on embedding-capable nightly/CI (or live DB) before release; tune `k` only with those numbers.

## Decision 5 — Short legitimate facts

Creation path unchanged. Search: short facts still get nonzero factor and text channel; unit tests assert they are not hard-zeroed for moderate lengths (e.g. 14–25).
