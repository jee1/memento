# FTS query combinator ablation (#807)

**Date**: 2026-08-29  
**Status**: measured (synthetic) — adopt **C** for text-candidate gates; vector precision deferred to #806  
**Related**: [spec.md](./spec.md), [research.md](./research.md) R5, historical note in `specs/061-785-epic-search-production-recall/fts-query-ablation.md`

## Variants

| ID | Description | Ship candidate? |
|----|-------------|-----------------|
| A | Current: short implicit AND / long first-8 OR | baseline (pre-#807) |
| B | Short+long OR, no prefix | compare |
| C | OR + prefix* (min stem length 2) | **adopted** (text gates) |
| D | `tokenize='trigram'` (index rebuild) | compare-only / not default |

## Results

| Variant | Fixture text zero-hit rate | Fixture text candidate notes | Top-10 relatedness (SC-002) | English gate | Vector precision (#806+) | Decision |
|---------|----------------------------|------------------------------|-----------------------------|--------------|--------------------------|----------|
| A | 100% on 4-token multi-concept (AND) | Issue live: AND=0; synth: all-terms-required → 0 | N/A (no text evidence) | n/a baseline | deferred until #806 | baseline |
| B | 0% (OR alone) | Synth: 4 partial docs all match OR; morphology `가중치` vs `가중치는` still misses without `*` | Synth: related IDs in candidate set | not re-run ad-hoc | deferred until #806 | compare |
| C | 0% | `fts-or-prefix-candidates.spec.ts`: multi-concept candidates > 0; `가중치*` hits `가중치는` | Synth candidates include related IDs (SC-001/003). Final top-10 hybrid relatedness: **record after #806** | See below | deferred until #806 | **ADOPT** for combinator default |
| D | — | Requires FTS rebuild; ops cost | — | — | — | compare-only / not default |

## Live corpus (optional, local only)

Issue #807 reported on `~/.memento/data/memory.db` for query `검색 랭킹 가중치 튜닝`:

| Way | FTS matches (issue) |
|-----|--------------------:|
| AND | 0 |
| OR | 713 |
| LIKE union truth | 832 |
| OR + prefix* | 836 |

Re-run locally if needed; **do not** commit DB dumps.

## English gate (US4)

| Item | Value |
|------|-------|
| Method | Existing nightly/bench thresholds only — **no new ad-hoc %** (Q7) |
| CI run in this worktree | Not executed as full LoCoMo (license); unit/integration gates green: `search-engine.spec.ts` + `fts-or-prefix-candidates.spec.ts` |
| Synthetic substitute | English tokens in unit path (`z test`, `foo bar baz`) — prefix/OR behavior covered |
| Record | **pass** for automated suite; full English session Recall/MRR remains **nightly owner** — if nightly regresses past existing gate, fail-closed → revert C |

## Adoption rule

- **Adopt C** for `buildFTSQuery` default based on SC-001/SC-003 synthetic gates + unit suite.
- Vector-precision / SC-002 hybrid top-10 judgment: **deferred until #806** absolute scores (Q8). If later SC-002 or English nightly fails → **reject**, revert to A, record reason here and on #807.
- Ranking weights untuned (SC-005). Trigram not default (FR-010).
