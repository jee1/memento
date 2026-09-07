# Checklist Review: #921 vector length decay

**Date**: 2026-09-07  
**Spec**: [spec.md](./spec.md)  
**Result**: PASS (with residual)

## Spec compliance

| ID | Status | Evidence |
|----|--------|----------|
| FR-001 | PASS | `vector-length-decay.ts` — `len/(len+k)` |
| FR-002 | PASS | Wired only in `hybrid-vector-search-executor` before threshold; no create-path gate |
| FR-003 | PASS | `[vector_length_decay]` in TOML + loader + version payload |
| FR-004 | PASS | unit + executor #921 tests (21 vs 663) |
| FR-005 | PASS | short-fact unit (14–25) nonzero; no CRUD gate |
| FR-006 | PARTIAL | Synthetic before/after recorded; nightly suite green but MiniLM/vec unavailable here |
| FR-007 | PASS | `getRankingVersionPayload` includes decay fields |
| FR-008 | PASS | `vector-length-decay.spec.ts` + executor regression |
| SC-001..002,004..005 | PASS | tests + type-check + graphify |
| SC-003 | RESIDUAL | Needs embedding-capable nightly/CI before/after for long-doc metrics |

## Constitution

- I Test-First: PASS (RED fixtures then GREEN)
- II Compat: PASS (contracts unchanged)
- III Schema: N/A
- IV Gates: PASS domain tests, type-check, graphify (6875 nodes)
- V Observability: PASS ranking version

## Findings (≥80 confidence)

### Important

1. **SC-003 incomplete in this worktree** (90) — `test:vector-search-quality` did not exercise real embeddings (`MiniLM … model is not a function`, missing vec tables). Re-run before/after on CI nightly or ops DB; adjust `characteristic_length` only from those numbers. Provisional `k=40` is justified by #903 cliff + synthetic inversion, not full quality gate.

### Suggestion

1. Short docs may fall below `HYBRID_VECTOR_THRESHOLD` after decay and rely on underfill/text — monitor recall of legitimate short facts on live traffic.

## simplify

No new abstractions beyond one pure helper + thin executor wrapper. Scope stayed on hybrid vector path.

## Verdict

**PASS** for implement/merge-candidate of the code path; **do not close SC-003** until quality before/after on a real embedding env is attached to the PR/issue.
