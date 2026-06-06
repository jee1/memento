# Data Model: Agent Session, Observation, Provenance

## Ownership

| Model | Owner | Consumers |
| --- | --- | --- |
| Wire envelope/result/capability | `@memento/agent-integration` | adapters, client, server |
| Session/observation/provenance domain | `@memento/core` | server |
| HTTP DTO mapping | `memento-server` | client |
| Agent API transport | `@memento/client` | agent integration |
| Turn lifecycle | `@memento/assistant` | external assistants |

```text
@memento/core <- memento-server
@memento/client <- @memento/assistant
@memento/client <- @memento/agent-integration
```

## AgentSession

Fields: `id` PK, `adapter_name`, `adapter_version`, `contract_version`, nullable `owner_id/project_id/process_id`, `status`, `started_at`, nullable `ended_at`, `last_event_at`, `max_sequence_no`, redacted `agent_metadata_json`, nullable `summary_memory_id`, nullable `degraded_reason`, `created_at`, `updated_at`.

```text
SESSION_START: (none) -> ACTIVE
PRE_COMPACT: ACTIVE|DEGRADED -> COMPACTING -> ACTIVE|DEGRADED
STOP: ACTIVE|COMPACTING|DEGRADED -> STOPPING -> COMPLETED|DEGRADED
TTL: ACTIVE|COMPACTING|DEGRADED -> ABANDONED
failure: ACTIVE|COMPACTING -> DEGRADED
late <= 5 min: terminal state unchanged
```

## AgentObservation

Fields: `id` PK, `adapter_name`, `event_id`, `session_id` FK, `event_type`, `sequence_no`, nullable `tool_name/outcome`, nullable redacted `payload_json`, `payload_sha256`, `redaction_metadata_json`, `status`, nullable `drop_reason`, `late_arrival`, `occurred_at`, `received_at`, nullable `expires_at`.

Constraints/indexes:

- `UNIQUE(adapter_name, event_id)`
- `(session_id, sequence_no, occurred_at, received_at)`
- `(expires_at)`
- `(status, drop_reason)`
- dropped observation은 payload 없이 audit row를 유지할 수 있다.

## MemoryProvenance

Fields: `id` PK, `memory_id` FK, nullable `session_id`, nullable `observation_id`, `derivation_type`, `source_deleted`, `created_at`.

- session 또는 observation 중 하나 이상 필수.
- observation이 있으면 `(memory_id, observation_id, derivation_type)` unique.
- `memory_link.derived_from`는 memory-to-memory 관계로 유지한다.
- `memory_item.session_id`는 attribution이므로 자동 provenance backfill하지 않는다.

## Enums

Capture status: `ACCEPTED`, `REDACTED`, `DUPLICATE`, `DROPPED`, `DEGRADED`, `INVALID`.

Reason code: `NONE`, `AUTH_FAILED`, `SERVER_UNAVAILABLE`, `TIMEOUT`, `QUEUE_OVERFLOW`, `INVALID_ENVELOPE`, `INVALID_PAYLOAD`, `UNSUPPORTED_CONTRACT_VERSION`, `UNSUPPORTED_EVENT_TYPE`, `SESSION_NOT_STARTED`, `INVALID_SESSION_STATE`, `IDEMPOTENCY_CONFLICT`, `SENSITIVE_PATH`, `BINARY_CONTENT`, `PRIVATE_KEY_MATERIAL`, `PAYLOAD_TOO_LARGE`, `BATCH_TOO_LARGE`, `SCHEMA_NOT_READY`, `INTERNAL_ERROR`.

## Migration

1. schema readiness check 추가.
2. 세 table과 index를 additive migration으로 생성.
3. `schema.sql` 동기화.
4. repository/read API를 feature-disabled로 배포.
5. tests/readiness 통과 후 write capability 활성화.
6. retention cleanup 별도 활성화.

Rollback은 write off, old server 복원, 신규 table 유지가 기본이다. table 제거는 backup과 명시 승인 후 별도 migration이다.
