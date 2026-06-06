# Contract: Security and Failure Matrix

## Processing Order

```text
allowlisted structure
  -> sensitive path/binary/private-key blocking
  -> recursive secret and PII redaction
  -> canonical serialization
  -> deterministic size reduction
  -> redacted payload hash
  -> queue
  -> persistence
```

redaction 전 payload를 logger, telemetry, error, retry metadata에 전달하지 않는다.

## Redaction

| Rule | Action |
| --- | --- |
| `API_KEY`, `TOKEN`, `PASSWORD`, `CREDENTIAL` | `[REDACTED:<RULE>]` |
| `EMAIL`, `PHONE` | `[REDACTED:<RULE>]` |
| `PRIVATE_KEY_MATERIAL` | field 또는 observation drop |
| `SENSITIVE_PATH` | content drop; path category만 유지 |
| `BINARY_CONTENT` | content drop |
| `HIGH_ENTROPY_SECRET` | placeholder 또는 fail-closed drop |

metadata에는 `{ rule, count }`만 남기며 matched value/prefix/suffix를 저장하지 않는다.

Sensitive path는 `.env*`, `~/.ssh/*`, AWS/GCP/Azure credential stores, `.npmrc`, `.pypirc`, `.git-credentials`, kubeconfig/service-account token을 포함한다.

## Size Policy

| Event | Preserve | Reduce first |
| --- | --- | --- |
| SESSION_START | client/model/scope | context, path detail |
| USER_PROMPT | content prefix/format | attachments, content tail |
| TOOL_RESULT | tool/outcome/summary | output, optional input, file list tail |
| PRE_COMPACT | budget/summary prefix | summary tail |
| STOP | outcome/summary prefix | error detail, summary tail |

축소 후 32KiB 초과면 `DROPPED/PAYLOAD_TOO_LARGE`다.

## Queue Priority

P0: STOP, failed/cancelled/timeout TOOL_RESULT
P1: PRE_COMPACT, SESSION_START
P2: USER_PROMPT
P3: successful TOOL_RESULT

overflow 시 P3부터 drop하고 같은 priority에서는 oldest non-terminal event를 drop한다.

## Fixture Matrix

| ID | Fixture | Expected |
| --- | --- | --- |
| F01 | valid lifecycle 5종 | ACCEPTED |
| F02 | repeated identical event | DUPLICATE, one row |
| F03 | same key/different hash | IDEMPOTENCY_CONFLICT |
| F04 | sequence inversion | accepted, late=true |
| F05 | invalid timestamp/schema | INVALID_ENVELOPE |
| F06 | API keys | redacted, raw 0 |
| F07 | JWT/password | redacted, raw 0 |
| F08 | email/phone | redacted, raw 0 |
| F09 | PEM private key | PRIVATE_KEY_MATERIAL |
| F10 | credential path content | SENSITIVE_PATH |
| F11 | binary/NUL | BINARY_CONTENT |
| F12 | 32KiB - 1 byte | accepted |
| F13 | oversized reducible | truncated accepted |
| F14 | oversized irreducible | PAYLOAD_TOO_LARGE |
| F15 | 51 events/>512KiB | BATCH_TOO_LARGE |
| F16 | invalid auth | AUTH_FAILED, no retry |
| F17 | timeout/down | bounded DEGRADED |
| F18 | queue overflow | priority-aware drop |
| F19 | schema missing | SCHEMA_NOT_READY |
| F20 | unsupported major | UNSUPPORTED_CONTRACT_VERSION |
| F21 | late within grace | stored, terminal unchanged |
| F22 | event after grace | INVALID_SESSION_STATE |

## Leak Verification

각 secret marker를 persistence input spy, SQLite dump, structured logs, telemetry attributes, retry queue state, error messages에서 exact search한다. 모든 surface에서 marker count는 0이어야 한다.

## Timeout and Retry

- hook enqueue target 50ms.
- network timeout default 1000ms, max 5000ms.
- transient failure 최대 2회 jittered bounded retry.
- auth, validation, unsupported contract, conflict는 retry하지 않는다.
- hook surface는 실패를 result로 변환하고 throw하지 않는다.
