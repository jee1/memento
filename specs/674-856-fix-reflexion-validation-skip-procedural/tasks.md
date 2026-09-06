# Tasks: 674-856-fix-reflexion-validation-skip-procedural

**Input**: [plan.md](./plan.md) · [spec.md](./spec.md)
**Issue**: [#856](https://github.com/jee1/memento/issues/856)

## Phase 1 — Setup

- [x] T001 Confirm all tools route failures through `BaseTool.handleFailure`; note touch list

## Phase 2 — US1 Validation skip [TDD] [REVIEW]

- [x] T002 [TDD] [US1] RED: `base-tool-handle-failure-validation.spec.ts` — `ToolInputValidationError` does not call `queueFailureEvent`; plain `Error` still does
- [x] T003 [TDD] [US1] GREEN: early return in `base-tool.ts` `handleFailure` (instanceof + name)

## Phase 3 — US2 Content fallback [TDD]

- [x] T004 [P] [TDD] [US2] RED+GREEN: `failure-detector.spec.ts` — content-only → no `original_task`; `task_goal` still sets it
- [x] T005 [P] [TDD] [US2] RED+GREEN: recorder task-goal spec — content-only uses without-task-goal path (no 200-char content as goal)

## Phase 4 — US3 Regression

- [x] T006 [US3] Re-run existing `failure-detector.spec.ts` tool_error / task_goal / queue cases

## Phase 5 — Polish

- [x] T007 Run lint + type-check
- [x] T008 Rebuild graphify; confirm `GRAPH_REPORT.md` (do not commit)
- [x] T009 Update `progress.yml` + `checklist-review.md`

## Dependencies

```text
T001 → T002 → T003 → (T004 ∥ T005) → T006 → T007 → T008 → T009
```

## Checkpoint Policy

User authorized full Speckit auto-advance (`진행해줘` + canonical Speckit memory).
No commit/push unless asked.
