# Superspec Code Review — 668-883

**Verdict: PASS**  
**Reviewed**: 2026-09-06  
**Scope**: spec.md, all contracts, changed dashboard JS/CSS, and focused panel specs.

## Requirement and Constitution Check

| Area | Result | Evidence |
|---|---|---|
| FR-001–002, SC-001 | PASS | Preview generation plus current candidate ID guard; deferred A→B regression test. |
| FR-003, SC-002 | PASS | Detail/timeline selection guard and timeline request generation; deferred A→B and same-session reverse-completion tests. |
| FR-004–005, SC-003 | PASS | Surviving selection/bulk/preview restoration and ID/priority/status/due/order fingerprint. |
| FR-006, SC-004 | PASS | Checkbox-target Space bypass is exercised in the VM harness. |
| FR-007–009, SC-005–006 | PASS | CSS contracts enforce tab scrolling, map `min-height: 200px`, and `[hidden]` precedence. |
| FR-010, SC-007 | PASS | Focused Vitest regression suite passes (26 tests); test command also completes the workspace TypeScript build. |
| Constitution I–V | PASS | Regression tests added before the corresponding fixes; no public API or schema change; Graphify rebuilt; client failures preserve the existing error paths. |

## Findings Resolved During Review

### Important

1. **`static/js/review-candidates-panel-shared.js:101` — order-only snapshot changes were ignored (confidence: 99).**  
   The fingerprint sorted candidate records, although FR-005 requires order to participate. Removed the sort and added a regression test proving A→B and B→A have distinct fingerprints.

2. **`static/js/agent-sessions-panel-data.js:80` — concurrent timeline refreshes for the same selected session could render in reverse completion order (confidence: 96).**  
   `detailGeneration` and `selectedSessionId` remain equal for same-session refreshes, so the older result could overwrite newer filters/cursor. Added `timelineGeneration` state and a matching stale-response guard, with a reverse-completion regression test.

3. **Focused #883 coverage was source-text-only for the primary async scenarios (confidence: 94).**  
   Added VM/deferred-Promise behavior tests for review preview A→B, session A→B, same-session timeline refreshes, and checkbox Space behavior.

## Remaining Findings

- Critical: 0
- Important: 0
- Suggestion: 0

## Verification

```text
npm test -- packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts packages/memento-server/src/server/dashboard-agent-sessions-panel.spec.ts
# 2 files passed, 26 tests passed
```

Graphify was rebuilt after the production-code changes; `graphify-out/` remains a local generated artifact.
