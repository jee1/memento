# Data Model: Agent Operations CLI

DB schema 변경은 없다. 이 문서는 API/CLI read model을 정의한다.

## Operations Status

```text
AgentOperationsStatus
├── generated_at: UTC ISO timestamp
├── window: { since, limit }
├── counts
│   ├── captures
│   ├── injections
│   ├── dropped
│   └── degraded
└── recent_events[]
    ├── occurred_at
    ├── kind: capture | injection
    ├── status
    ├── reason_code
    ├── session_id?
    ├── adapter_name?
    └── event_type?
```

### Invariants

- `since`는 현재 이전이며 최대 7일 전이다.
- `limit`은 1~100이다.
- observation payload/hash/redaction metadata는 포함하지 않는다.
- telemetry `extra_data`는 필요한 allowlisted scalar만 parse하고 원문을 반환하지 않는다.
- drop은 observation `status=DROPPED`, degraded는 observation/session/injection degraded다.

## Doctor Result

```text
AgentDoctorResult
├── command: doctor
├── ok
├── checked_at
├── endpoint
├── checks[]
│   ├── name
│   ├── status: pass | fail | warn | skip
│   ├── reason_code
│   └── message
├── compatibility[]
└── guidance[]
```

Check 이름은 `endpoint`, `auth`, `schema`, `version`, `contract`, `redaction`,
`cleanup`으로 안정화한다.

## Demo Result

```text
AgentDemoResult
├── command: demo
├── ok
├── checked_at
├── endpoint
├── steps[]
│   ├── name
│   ├── status
│   ├── reason_code
│   └── message
├── injection
│   ├── status
│   ├── selected_count
│   └── summary_reused
└── guidance[]
```

Session ID는 생성된 opaque identifier이며 payload/content는 결과에 포함하지 않는다.

## Reason Guide

```text
ReasonGuide
├── reason_code
├── category: connectivity | auth | schema | compatibility | capacity | security | lifecycle | internal
└── action
```

API key, request body, stack trace를 포함하지 않는다.
