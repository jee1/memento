# Checklist Review: 660-807-fts-or-prefix (#807)

**Date**: 2026-08-29  
**Command**: `/speckit.superspec.review`  
**Skill**: `requesting-code-review` (superpowers)  
**Base**: `a40b474d` (working tree uncommitted)  
**Verdict**: **With fixes** (no Critical)

Confidence threshold: findings below 80 suppressed.

## Strengths

- Single entry point `buildFTSQuery`: short/long → `OR` + `prefix*` (min stem ≥ 2)
- Real FTS5 MATCH coverage in `fts-or-prefix-candidates.spec.ts` (US1/US2)
- Unit regression: OR+prefix, 1-char stem, operator sanitization, long cap
- Scope control: no `ranking-weights.toml`, no MCP schema, ablation documents C adopt / trigram compare-only / #806 defer
- `docs/agents/search-ranking.md` aligned with code

## Issues (confidence ≥ 80)

### Critical

None.

### Important

| # | Conf | Location | Finding | Recommendation |
|---|------|----------|---------|----------------|
| 1 | 95 | `specs/660-807-fts-or-prefix/**`, `fts-or-prefix-candidates.spec.ts` | Untracked — FR-021/SC-006 not reproducible until commit | Include in PR commit |
| 2 | 88 | `fts-query-ablation.md` (English gate) | Full English Recall/MRR not run in-session; unit + nightly owner only | Run nightly/bench once or label PR “nightly gate pending” |
| 3 | 85 | `.cursor/rules/specify-rules.mdc` | `update-agent-context` dropped 3 unrelated Recent Changes lines | Restore deleted bullets or drop file from feature diff |

### Suggestion

| # | Conf | Location | Finding | Recommendation |
|---|------|----------|---------|----------------|
| 1 | 82 | `vector-search-hybrid-query.ts` (~275) | Pre-existing `textQuery.trim()` bypass of `buildFTSQuery` (FR-020 gap on vector-hybrid SQL path) | Follow-up: route through `buildFTSQuery` |
| 2 | 80 | Constitution IV | Full `npm test` + graphify not re-verified in this review pass | Re-run before merge |

## Spec compliance matrix

| Item | Status |
|------|--------|
| US1 multi-concept text candidates | pass |
| US2 particle/morphology prefix | pass |
| US3 top relevance / SC-002 | partial — deferred to #806 |
| US4 English regression / SC-004 | partial — nightly owner |
| US5 ablation record | pass (commit pending) |
| FR-001/002/003/007/009–011/014–019 | pass |
| FR-004/021 | pass (commit pending) |
| FR-005/006/022 | deferred (#806) |
| FR-008/SC-004 | partial |
| FR-012/SC-007 | deferred (#808) |
| FR-020 | pass primary recall; partial vector-hybrid SQL |
| Edge Q1–Q15 | reflected |

## Constitution

| Principle | Status |
|-----------|--------|
| I Test-First | pass |
| II Backward Compatibility | pass |
| III Schema/Migration | n/a |
| IV Quality Gates | partial (full suite recheck) |
| V Observability | pass |

## Assessment

Core OR+prefix implementation matches spec/plan/contracts for the primary recall path. Merge after committing untracked artifacts, addressing specify-rules drift, and clarifying English nightly gate. #806/#808 deferrals are documented and are not merge blockers for text-candidate gates.
