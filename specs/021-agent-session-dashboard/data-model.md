# Data Model: Agent Session Dashboard Read Models

## AgentSessionListItem

- session: 기존 safe session DTO
- aggregate:
  - total
  - late
  - by_event_type
  - by_status
  - redacted
  - dropped
  - degraded

Cursor는 `(last_event_at, id)`를 base64url JSON으로 인코딩한다.

## AgentSessionAggregate

- sessions_total
- sessions_by_status
- observations_total
- observations_by_status
- observations_by_event_type
- redacted_total
- dropped_total
- degraded_total
- late_total

## AgentObservationTimelineItem

기존 observation DTO +

- event_category: `prompt | tool | result | error | response | lifecycle`
- redaction_count: number
- has_payload: boolean

금지 필드:

- payload_json
- payload_sha256
- redaction metadata의 원문 key/value

## AgentProvenanceDetail

- edges: 기존 provenance DTO
- memories: id/type/content_preview/created_at/source_deleted
- observations: safe timeline DTO
- sessions: safe session DTO

조회는 memory_id 또는 observation_id 중 하나를 요구하고 최대 100 edge로 제한한다.

## AgentInjectionDetail

- injection_id
- session_id
- trigger
- status
- created_at
- token_budget
- token_used
- degraded_reasons
- candidates:
  - memory_id
  - decision: selected | excluded
  - score
  - token_estimate
  - reason
  - used

## TranscriptValidationResult

- dry_run
- valid
- line_count
- accepted_count
- duplicate_count
- redacted_count
- dropped_count
- sessions
- errors: line/code/message
- results: line/event_id/session_id/status/reason_code

오류 message는 입력 payload 값을 포함하지 않는다.

## Persistence

신규 table과 migration은 없다. 기존:

- `agent_session`
- `agent_observation`
- `memory_provenance`
- `memory_item`
- `telemetry_events`

만 사용한다.
