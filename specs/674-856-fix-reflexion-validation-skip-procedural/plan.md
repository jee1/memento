# Implementation Plan: 입력 검증 거절이 procedural memory를 생성

**Branch**: `feature/fix-reflexion-procedural-memory-content-task_goa` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/674-856-fix-reflexion-validation-skip-procedural/spec.md`
**Issue**: [#856](https://github.com/jee1/memento/issues/856)

## Summary

`ToolInputValidationError` 가 Reflexion 깔때기를 타며 `params.content` 가
`task_goal` 로 승격된다. 수정은 세 지점:

1. `base-tool.ts` `handleFailure` — validation 에러면 detect/queue 스킵 (instanceof + name).
2. `failure-detector.ts` `detectToolError` — `content` → `original_task` 폴백 제거.
3. `reflexion-reflection-recorder.ts` `extractTaskGoal` — `content` 폴백 제거.

TDD: BaseTool 서브클래스 + failure-detector 스펙으로 RED→GREEN.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ESM
**Primary Dependencies**: none new
**Storage**: N/A (behavior change; no schema migration)
**Testing**: Vitest — tools / monitoring / infrastructure specs
**Target Platform**: MCP stdio/HTTP (all BaseTool subclasses)
**Project Type**: monorepo bugfix in core
**Performance Goals**: fewer queue writes on invalid calls (improvement)
**Constraints**: Principle I TDD; Principle II MCP contracts unchanged; graphify after prod edit
**Scale/Scope**: 3 production files + 2–3 test files

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED tests before guards / fallback removal |
| Backward compatibility MCP | II (MUST) | PASS | validation still rejects; Reflexion side-effect only |
| Schema/migration | III (MUST) | N/A | no schema; legacy cleanup Non-Goal |
| Quality gates | IV (MUST) | PASS | lint / type-check / test + graphify |
| Observability | V (SHOULD) | PASS | optional info log on skip; primary path intact |
| Additional Constraints | | PASS | Node 24 ESM |

## Project Structure

### Documentation (this feature)

```text
specs/674-856-fix-reflexion-validation-skip-procedural/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/reflexion-validation-skip.md
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
packages/memento-core/src/tools/base-tool.ts
packages/memento-core/src/domains/monitoring/services/failure-detector.ts
packages/memento-core/src/infrastructure/reflexion-reflection-recorder.ts
packages/memento-core/src/tools/__tests__/base-tool-handle-failure-validation.spec.ts  # new
packages/memento-core/src/domains/monitoring/services/__tests__/failure-detector.spec.ts
packages/memento-core/src/infrastructure/__tests__/reflexion-reflection-recorder-task-goal.spec.ts  # new or extend
```

## Complexity Tracking

없음.

## Execution Strategy

- Setup: confirm call sites all use `handleFailure`.
- US1 [TDD]: BaseTool validation skip test → implement early return.
- US2 [TDD]: content fallback tests → remove both fallbacks.
- US3: re-run existing failure-detector cases.
- Polish: lint / type-check / focused tests / graphify / checklist-review.
