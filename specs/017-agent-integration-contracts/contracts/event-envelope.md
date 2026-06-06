# Contract: Agent Lifecycle Event Envelope v1

```typescript
type AgentEventType =
  | 'SESSION_START'
  | 'USER_PROMPT'
  | 'TOOL_RESULT'
  | 'PRE_COMPACT'
  | 'STOP';

interface AgentEventEnvelope<TType extends AgentEventType, TPayload> {
  contract_version: 1;
  event_id: string;
  event_type: TType;
  occurred_at: string;
  adapter_name: string;
  adapter_version: string;
  session_id: string;
  sequence_no: number;
  scope: {
    owner_id?: string;
    project_id?: string;
    process_id?: string;
  };
  payload: TPayload;
}
```

## Common Rules

- identifier는 trim 후 1..255자이며 control character를 허용하지 않는다.
- `adapter_name`은 lowercase kebab-case, 최대 64자다.
- `occurred_at`은 timezone이 포함된 ISO 8601 instant다.
- `sequence_no`는 safe non-negative integer다.
- unknown top-level field는 v1에서 `INVALID_ENVELOPE`다.
- optional extension은 `payload.extensions` 안에서만 허용한다.

## Event Payloads

| Event | Required payload | Optional bounded payload |
| --- | --- | --- |
| `SESSION_START` | `client_version` | `model`, masked `working_directory`, `initial_context` |
| `USER_PROMPT` | `content`, `content_format` | attachment metadata; binary body 금지 |
| `TOOL_RESULT` | `tool_name`, `outcome` | `duration_ms`, redacted `input/output`, `file_changes` |
| `PRE_COMPACT` | `context_summary`, `token_budget` | extensions |
| `STOP` | `outcome` | `summary`, redacted `error` |

`TOOL_RESULT.outcome`: `success`, `error`, `cancelled`, `timeout`.
`STOP.outcome`: `completed`, `cancelled`, `failed`, `abandoned`.
`PRE_COMPACT.token_budget`: 1..32768.

## Example

```json
{
  "contract_version": 1,
  "event_id": "evt-01J...",
  "event_type": "TOOL_RESULT",
  "occurred_at": "2026-06-06T01:02:00.000Z",
  "adapter_name": "codex",
  "adapter_version": "1.0.0",
  "session_id": "ses-01J...",
  "sequence_no": 2,
  "scope": {
    "owner_id": "local-user",
    "project_id": "github.com/jee1/memento",
    "process_id": "issue-453"
  },
  "payload": {
    "tool_name": "exec_command",
    "outcome": "success",
    "duration_ms": 42,
    "input": { "command": "npm test" },
    "output": { "summary": "42 tests passed", "content": "..." },
    "file_changes": ["packages/example.ts"]
  }
}
```

## Canonicalization and Hashing

1. object key를 Unicode code point 순으로 정렬한다.
2. undefined는 제거하고 null은 보존한다.
3. finite JSON number만 허용한다.
4. redaction과 size policy 후 UTF-8 JSON을 SHA-256 한다.
5. hash는 lowercase hex 64자다.

## Idempotency and Ordering

- 동일 key + 동일 hash: `DUPLICATE`, 기존 observation id 반환.
- 동일 key + 다른 hash: `INVALID/IDEMPOTENCY_CONFLICT`.
- duplicate는 state transition과 success metric을 재적용하지 않는다.
- `sequence_no < max_seen_sequence_no`면 `late_arrival=true`.
- timeline order는 `(sequence_no, occurred_at, received_at, observation_id)`다.
- terminal session은 5분 grace window의 late event를 저장해도 상태를 되돌리지 않는다.
