# Data Model: #811

No SQLite DDL changes.

## Logical entities

| Entity | Definition |
|--------|------------|
| Broken triple content | `hasBrokenTripleConjugation(content) === true` |
| Clean injection candidate | Search hit that fails the broken check |
| ToolInputValidationError | Client-fixable tool input error; MCP → `-32602` |
| Vector distance | Cosine distance from sqlite-vec; similarity = `clamp(1 - d, 0, 1)` via shared util |

## State transitions

- Injection shortlist: raw hits → filter broken → (optional expand search) → summarize ≤ `maxMemories`
- Tool error: validation throw → `mapToolExecutionErrorToJsonRpc` → JSON-RPC `-32602`
