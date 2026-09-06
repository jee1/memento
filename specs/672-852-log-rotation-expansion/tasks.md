# Tasks: Expand log_rotation Beyond Triple-Extraction

**Feature**: 672-852-log-rotation-expansion  
**Issue**: #852  
**Branch**: `feature/chore-ops-log_rotation-triple-extraction-migrati`  
**Date**: 2026-09-06

## Phase checkpoints

- Setup → Foundational sequential
- US1+US4, US2, US3 can parallelize after Foundational `[P][SUBAGENT]`
- Wire handler after family modules green
- Polish + quality gates last
- AUTO-APPROVE phase checkpoints (user Speckit #852 full pipeline)

---

## Phase 0 — Setup

- [x] T001 Create logging module stubs: `log-rotation-policies.ts`, `log-rotation-paths.ts`, `log-rotation.ts` under `packages/memento-core/src/infrastructure/logging/`
- [x] T002 [P] Confirm existing `triple-extraction-logger.spec.ts` still targeted; note baseline age tests

## Phase 1 — Foundational

- [x] T003 [TDD] Implement policy defaults + env parsing (`LOG_ROTATION_*`) with unit assertions for defaults and `keepCount<=0`
- [x] T004 [TDD] Implement injectable path resolvers (migration=`dirname(dbPath)/logs`, TE, diagnostics, monitor) — tests pass fake roots only
- [x] T005 [TDD] Implement `LogRotationReport` aggregation helpers (no abs paths in warning formatter)

## Phase 2 — US1 + US4 Migration count cap + high-churn proof

- [x] T006 [TDD] [US1] [US4] RED: fixture ≥1000 in-window `migration_*.log` → expect survivors = keepCount under default
- [x] T007 [TDD] [US4] RED: same fixture with keepCount 0 → expect 0 surplus deletions (age-only failure doc)
- [x] T008 [US1] GREEN: migration selector sort (mtime desc, basename tie-break) + delete surplus
- [x] T009 [P] [US1] Non-migration files in same dir untouched

## Phase 3 — US2 docker-diagnostics byte budget

- [x] T010 [TDD] [US2] [P] [SUBAGENT] RED/GREEN: oversized rotated segments reduced to ≤ maxTotalBytes; single active under budget retained
- [x] T011 [P] [US2] Optional docs note in `docs/operations` or quickstart only (collector change optional) — covered by specs/.../quickstart.md

## Phase 4 — US3 TE + monitor

- [x] T012 [TDD] [US3] [P] [SUBAGENT] TE age deletion via orchestrator (delegate or wrap `deleteOldLogs`)
- [x] T013 [TDD] [US3] [P] [SUBAGENT] monitor: protect `state.json`; trim/rotate oversized jsonl; missing root skip

## Phase 5 — Wire job

- [x] T014 [TDD] Update `runLogRotation` to call orchestrator; map `processed`/`details`/`warnings` per contract
- [x] T015 Handler/unit smoke: mock fs roots or orchestrator; assert additive details shape

## Phase 6 — Polish

- [x] T016 [P] Update AGENTS.md §3.1 gotcha one-liner for log_rotation families/caps (if hook does not auto)
- [x] T017 [P] Update CHANGELOG entry under Unreleased
- [x] T018 Run `npm run lint` + `npm run type-check` on touched packages
- [x] T019 Run focused vitest for logging + any handler specs
- [x] T020 Graphify rebuild after production code changes; confirm `GRAPH_REPORT.md`
- [x] T021 [REVIEW] Superspec review checklist → PASS (Critical/Important = 0)

## Dependencies

```text
T001 → T003 → T004 → T005 → (T006–T009 ∥ T010–T011 ∥ T012–T013) → T014 → T015 → T016–T020 → T021
```

## Parallel opportunities

After T005: US1/US4, US2, US3 streams `[P][SUBAGENT]`.
