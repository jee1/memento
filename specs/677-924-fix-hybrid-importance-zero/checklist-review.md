# Review Checklist: #924 hybrid importance 0

**Date**: 2026-09-07  
**Result**: PASS  
**Spec**: [spec.md](./spec.md)

## Spec compliance

| ID | Criterion | Verdict |
|----|-----------|---------|
| FR-001 | importance 0 used as-is | PASS — `?? 0.5` at hybrid-result-ranker.ts:177 |
| FR-002 | null/undefined → 0.5 | PASS — test "defaults missing importance" |
| FR-003 | 0 < 0.1 < 0.5 monotonic | PASS — test "#924" |
| FR-004 | regression + existing tests | PASS — 8/8 green |
| FR-005 | surgical scope | PASS — ranker + spec only; no anchor drive-by |
| SC-001..004 | success criteria | PASS |

## Edge cases

- importance 0 / 0.1 / 0.5 / undefined covered
- Existing relevance-slot importance test still green

## Constitution

- I Test-First: RED observed (`0.325 !< 0.245`) then GREEN
- II Compat: missing still defaults 0.5
- III Schema: N/A
- IV Gates: type-check + domain tests + graphify
- simplify: single operator change, no new abstraction

## Findings (≥80 confidence)

None.

## Out of scope (noted)

- `anchor-reanchor-service.ts:84` still uses `importance || 0.5` — separate debt
