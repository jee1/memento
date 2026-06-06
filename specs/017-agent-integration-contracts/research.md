# Research: Agent Integration Contracts

## Decisions

### 신규 workspace

`@memento/agent-integration`이 wire contract, adapter normalization, redaction/size policy, queue를 소유한다. `@memento/assistant` 하위 모듈은 turn lifecycle 공개 API와 coding hook 계약을 결합하므로 기각한다. server/core 소유는 agent별 형식을 내부 계층으로 유입시키므로 기각한다.

### 계약 표현

TypeScript discriminated union과 동일 의미의 generated JSON Schema를 제공한다. source of truth는 하나이며 수동 이중 편집은 허용하지 않는다.

### 식별자와 idempotency

`session_id`와 `event_id`는 adapter가 생성한 opaque ID다. key는 `(adapter_name, event_id)`이며 충돌 검증 hash는 redaction과 canonical JSON 이후 SHA-256으로 계산한다.

### sequence와 late arrival

`sequence_no`는 0 이상 단조 증가 의도지만 server는 역전을 거절하지 않는다. `sequence_no < max_seen`이면 late다. timeline은 `(sequence_no, occurred_at, received_at, observation_id)`로 정렬한다. STOP 후 grace window는 5분이다.

### 보안 처리 순서

allowlist → sensitive path/binary block → recursive redaction → canonical serialization → 32KiB policy → hash → queue/persistence 순이다.

기존 `PIIMasker` 패턴은 참고할 수 있으나 `ENABLE_PII_MASKING=false`가 가능하므로 agent capture 경계로 직접 사용하지 않는다. capture redaction은 비활성화 불가능한 fail-closed policy다.

### Limits와 retention

event redacted payload 32KiB, batch 50 events/512KiB다. redacted observation payload retention 기본은 30일, 설정 범위는 1~90일이다.

### API와 인증

`/api/v1/agent` namespace와 기존 Bearer/X-API-Key programmatic auth를 재사용한다. browser session cookie와 혼용하지 않는다.

### Migration과 rollback

expand/contract 전략을 사용한다. table/index를 additive로 추가하고 schema readiness 이후 write를 켠다. legacy `memory_item.session_id`를 provenance로 추정 backfill하지 않는다. rollback은 write off → old server → 승인된 별도 destructive cleanup 순이다.
