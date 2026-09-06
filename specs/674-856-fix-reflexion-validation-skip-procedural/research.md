# Research: 674-856 Reflexion validation skip

## Decision 1 — Guard at `handleFailure`, not ErrorType expansion

**Choice**: Early return in `BaseTool.handleFailure` when
`ToolInputValidationError` (instanceof or `name`).

**Rationale**: Single funnel for all tools; issue analysis; no enum migration.

**Alternatives rejected**: New `ErrorType.VALIDATION` + detector filter (more surface,
same outcome); per-tool try/catch (24 sites, drift).

## Decision 2 — Dual content-fallback removal

**Choice**: Remove `params.content` → `original_task` in both
`FailureDetector.detectToolError` and `ReflexionReflectionRecorder.extractTaskGoal`.

**Rationale**: Either path alone can still pollute `task_goal`.

**Alternatives rejected**: Detector-only (recorder still truncates content);
recorder-only (detector still sets `original_task`).

## Decision 3 — Legacy DB cleanup out of scope

**Choice**: Non-Goal for this PR.

**Rationale**: Symptom stop ≠ data repair; ops needs dry-run against live DB path.

## Decision 4 — name + instanceof

**Choice**: Match `recall-tool` / AGENTS.md #811 pattern.

**Rationale**: Cross-bundle Error identity can fail instanceof.

## Code references (pre-fix)

- `packages/memento-core/src/tools/base-tool.ts:212-256` — funnel
- `packages/memento-core/src/domains/monitoring/services/failure-detector.ts:97-104` — content fallback
- `packages/memento-core/src/infrastructure/reflexion-reflection-recorder.ts:302-316` — content truncate
