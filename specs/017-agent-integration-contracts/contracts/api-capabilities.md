# Contract: Agent Integration API v1

**Base path**: `/api/v1/agent`
**Auth**: Bearer 또는 `X-API-Key`, 기존 programmatic auth
**Error**: `{ "status", "reason_code", "message", "retryable" }`

## GET /capabilities

```json
{
  "contract_versions": [1],
  "event_types": ["SESSION_START", "USER_PROMPT", "TOOL_RESULT", "PRE_COMPACT", "STOP"],
  "limits": {
    "event_payload_bytes": 32768,
    "batch_events": 50,
    "batch_payload_bytes": 524288,
    "hook_return_target_ms": 50
  },
  "features": {
    "session_storage": true,
    "provenance_trace": true,
    "pre_compact_injection": false
  },
  "schema_ready": true
}
```

## Capabilities

| Method/path | Input | Output |
| --- | --- | --- |
| `POST /sessions` | SESSION_START | session, observation, initial injection |
| `POST /observations:ingest` | 최대 50 events | ordered per-event results |
| `POST /sessions/{id}:pre-compact` | PRE_COMPACT | 독립 capture + injection result |
| `POST /sessions/{id}:stop` | STOP | terminal state + summary job id |
| `GET /sessions/{id}` | session id | metadata + aggregate, payload 제외 |
| `GET /sessions/{id}/observations` | cursor/filter | canonical timeline |
| `GET /provenance` | memory_id 또는 observation_id | bounded directional graph |

Ingest는 partial success를 허용한다. 개별 policy drop은 HTTP 200의 `DROPPED` result이고 request/batch limit 초과는 전체 413이다. PreCompact injection 실패는 capture를 rollback하지 않는다.

## Capture Result

```json
{
  "event_id": "evt-03",
  "status": "REDACTED",
  "reason_code": "NONE",
  "observation_id": "obs-03",
  "late_arrival": false,
  "redaction": {
    "count": 2,
    "rules": ["API_KEY", "EMAIL"]
  }
}
```

## Pagination and Trace

- observation list: opaque cursor, default 50, max 100.
- filters: event type, status, from/to.
- provenance: `direction=sources|derived|both`, `max_depth` default 3, max 10.
- cycle은 visited set으로 중단하고 `truncated=true`를 표시한다.

## HTTP Mapping

| HTTP | Meaning |
| --- | --- |
| 200/201 | accepted, duplicate, per-event dropped/degraded |
| 400 | invalid envelope/payload |
| 401 | auth failed |
| 404 | session/source not found |
| 409 | idempotency conflict, invalid state |
| 413 | request/batch limit exceeded |
| 422 | unsupported contract/event |
| 503 | schema not ready/server unavailable |

Hook-facing SDK는 모든 결과를 non-throwing `CaptureResult`로 변환한다. 직접 client API는 기존 client error convention을 유지할 수 있다.
