# Data Model: 674-856

Schema unchanged. Behavioral constraints on existing fields:

| Field / Entity | Constraint after fix |
|----------------|----------------------|
| `memory_item.type='procedural'` from Reflexion | MUST NOT be created solely from `ToolInputValidationError` |
| `memory_item.task_goal` (Reflexion path) | Set only from explicit `task_goal` / `FailureEvent.original_task` |
| `FailureEvent.original_task` | From `params.task_goal` only in `detectToolError` |
| `ToolInputValidationError` | Client-fixable; not a Reflexion source |

No migration file. Legacy polluted rows remain until ops follow-up.
