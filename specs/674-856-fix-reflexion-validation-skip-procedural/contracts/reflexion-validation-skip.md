# Contract: Reflexion vs ToolInputValidationError

## Invariants

1. `ToolInputValidationError` MUST NOT enqueue a `FailureEvent` for Reflexion.
2. `FailureEvent.original_task` from `detectToolError` MUST equal `String(params.task_goal)` when present; otherwise MUST be unset (not derived from `content`).
3. Recorder task-goal resolution MUST NOT use `context.params.content`.
4. Non-validation `Error` MUST still be detectable as `ErrorType.TOOL_ERROR`.

## Observability

Skip MAY log at info/debug with tool name + `reason: input_validation` (optional).
MUST NOT throw from the skip path.
