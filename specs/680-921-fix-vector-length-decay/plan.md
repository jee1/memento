# Implementation Plan: Vector score soft length decay (#921)

**Branch**: `feature/fix-search` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/680-921-fix-vector-length-decay/spec.md`

## Summary

Apply a continuous monotone length factor `len/(len+k)` to hybrid vector
`similarity` **before** threshold / under-fill / fusion, so short machine-generated
sentences stop outranking longer relevant answers. Expose `enabled` +
`characteristic_length` via `config/ranking-weights.toml` and include them in
`getRankingVersionPayload`. Pick default `k` with #920 nightly quality
before/after (provisional start from #903 cliff ≈40). No create-time length gate.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js ≥24 (ESM)  
**Primary Dependencies**: Vitest, `@memento/core` search domain, ranking-weights TOML  
**Storage**: N/A (search-time transform only)  
**Testing**: Vitest pure-function + hybrid-vector-search-executor / outcome-utils specs  
**Target Platform**: library (MCP/HTTP hybrid recall path)  
**Project Type**: monorepo package `memento-core`  
**Performance Goals**: O(n) over vector prefetch (≤100) — negligible  
**Constraints**: Surgical; no schema; no create-path gate; cosine contract unchanged  
**Scale/Scope**: small helper + 2 call sites + config/version + tests + quality note

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I | PASS | RED tests for factor monotonicity + short-vs-long rank before GREEN |
| MCP/API backward compat | II | PASS | Tool contracts unchanged; ranking scores shift intentionally |
| Schema/migrations | III | N/A | No schema |
| Quality gates | IV | PASS | domain tests + type-check + graphify; nightly quality before/after for `k` |
| Observability | V | PASS | ranking version hash includes decay params |
| Additional Constraints | — | PASS | No corpus commits |

## Project Structure

### Documentation (this feature)

```text
specs/680-921-fix-vector-length-decay/
├── plan.md
├── research.md
├── quickstart.md
├── spec.md
├── tasks.md
├── progress.yml
└── checklists/requirements.md
```

### Source Code

```text
packages/memento-core/src/domains/search/algorithms/vector-length-decay.ts          # NEW pure helper
packages/memento-core/src/domains/search/algorithms/vector-length-decay.spec.ts     # NEW
packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.ts  # apply before threshold
packages/memento-core/src/domains/search/algorithms/hybrid-search-outcome-utils.ts    # optional re-export / keep threshold pure
packages/memento-core/src/shared/config/ranking-weights-loader.ts                   # TOML + version payload
packages/memento-core/src/shared/config/ranking-weights-loader.spec.ts
config/ranking-weights.toml
docs/agents/search-ranking.md                                                      # short section
```

## Execution Strategy

1. **TDD**: Pure `vectorLengthDecayFactor` + apply-before-threshold ranking fixture (21/22 vs 663 char case).
2. **Config**: `[vector_length_decay]` in TOML; defaults `enabled=true`, `characteristic_length=40`; version payload fields.
3. **Wire**: Both `filterByVectorThreshold` call sites in `hybrid-vector-search-executor.ts` receive decayed results.
4. **Quality**: Run available nightly/quality harness before (disable or k→0) vs after; record in research.md / progress.yml. Tune `k` if long-doc metrics regress.
5. **Gates**: domain vitest → type-check → graphify → superspec.review.
6. **No commit/push** unless asked.

## Complexity Tracking

None — no constitution violations.
