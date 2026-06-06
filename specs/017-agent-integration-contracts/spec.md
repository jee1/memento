# Feature Specification: Agent Integration Contracts

**Feature Branch**: `017-agent-integration-contracts`
**Created**: 2026-06-06
**Status**: Ready for Implementation
**Input**: Issue #453 and `tasks/0452-prd-agent-integration.md`

## User Scenarios & Testing

### User Story 1 - Adapter 독립 이벤트 계약 (Priority: P1)

adapter 개발자는 Codex 또는 Claude Code의 원본 hook 형식과 관계없이 하나의 공통 lifecycle envelope로 세션 이벤트를 전달할 수 있어야 한다.

**Why this priority**: 공통 계약이 없으면 adapter별 조건문이 server와 core로 유입되어 후속 저장, provenance, 보안 구현을 독립적으로 진행할 수 없다.

**Independent Test**: lifecycle 5종 fixture를 공통 계약으로 검증하고 필수 필드 누락·중복·순서 역전 결과를 예측할 수 있으면 검증된다.

**Acceptance Scenarios**:

1. **Given** 지원 adapter가 lifecycle event를 생성한 상태, **When** envelope 검증을 수행하면, **Then** 필수 식별자·시각·sequence·payload 규칙을 통과하거나 안정된 reason code로 거절된다.
2. **Given** 동일 `(adapter_name, event_id)`가 재전송된 상태, **When** ingest하면, **Then** 기존 결과를 반환하고 observation을 중복 생성하지 않는다.
3. **Given** 높은 sequence가 먼저 저장된 상태, **When** 낮은 sequence가 도착하면, **Then** 수신하되 late arrival로 표시한다.

### User Story 2 - 저장 전 민감정보 차단 (Priority: P1)

사용자는 lifecycle payload에 secret, PII, credential 경로 또는 과도한 tool output이 포함되어도 원문이 DB, 로그, telemetry에 남지 않을 것을 신뢰할 수 있어야 한다.

**Why this priority**: 자동 수집은 수동 저장보다 데이터 범위가 넓으므로 저장 전에 적용되는 fail-closed 보안 계약이 선행되어야 한다.

**Independent Test**: 보안 fixture 처리 후 persistence input, log, telemetry 전체에서 금지 문자열이 0건인지 검사한다.

**Acceptance Scenarios**:

1. **Given** token·password·API key·PII가 포함된 상태, **When** redaction하면, **Then** 안정된 placeholder와 규칙명·개수만 남는다.
2. **Given** `.env`, SSH private key, cloud credential 경로 또는 바이너리 내용인 상태, **When** 정책을 적용하면, **Then** 원문 없이 필드 또는 observation이 차단된다.
3. **Given** redaction 후 payload가 32KiB를 초과한 상태, **When** size 정책을 적용하면, **Then** deterministic truncation 또는 명시적 drop이 수행된다.

### User Story 3 - 구현 가능한 패키지·API·schema 경계 (Priority: P2)

Core, Server, Client, Assistant, Agent Integration 기여자는 책임과 의존성 방향, API capability, schema migration 순서를 추가 제품 결정 없이 구현할 수 있어야 한다.

**Why this priority**: 경계를 먼저 고정해야 #454와 #461을 병렬 진행하면서 중복 타입, 순환 의존, assistant breaking change를 피할 수 있다.

**Independent Test**: 각 후속 이슈가 소유 패키지, 입출력 계약, migration 단계, rollback 조건을 문서만으로 식별할 수 있으면 검증된다.

**Acceptance Scenarios**:

1. **Given** 신규 adapter 구현이 필요한 상태, **When** 경계를 확인하면, **Then** agent-specific payload 해석은 `@memento/agent-integration` 밖으로 유출되지 않는다.
2. **Given** persistence를 추가하는 상태, **When** migration 계획을 따르면, **Then** additive schema로 배포되고 legacy memory와 MCP 도구는 그대로 동작한다.
3. **Given** server와 adapter 버전이 다른 상태, **When** capability negotiation을 수행하면, **Then** 지원 범위를 확인하거나 명시적 degraded 결과를 받는다.

### User Story 4 - 장애 격리 (Priority: P2)

사용자는 Memento timeout, 인증 실패, queue overflow, migration 미완료가 발생해도 코딩 작업을 계속할 수 있어야 한다.

**Independent Test**: 장애 fixture마다 adapter 호출이 throw하지 않고 제한 시간 안에 accepted, degraded 또는 dropped를 반환하는지 검증한다.

**Acceptance Scenarios**:

1. **Given** server가 응답하지 않는 상태, **When** capture하면, **Then** bounded timeout 후 `DEGRADED`를 반환하고 예외를 전파하지 않는다.
2. **Given** queue가 포화된 상태, **When** 이벤트가 추가되면, **Then** 낮은 우선순위부터 drop하고 종료·오류 이벤트를 우선 보존한다.
3. **Given** 인증이 실패한 상태, **When** 전송하면, **Then** 무한 재시도하지 않고 `AUTH_FAILED`를 집계한다.

### Edge Cases

- `SESSION_START` 전 observation은 `SESSION_NOT_STARTED`다.
- `STOP` 후 5분 grace window의 late event는 저장하되 terminal 상태를 되돌리지 않는다.
- 같은 idempotency key와 다른 redacted hash는 기존 observation을 덮어쓰지 않는다.
- clock skew가 있어도 `received_at`을 별도 저장한다.
- 직렬화 불가 payload는 `INVALID_PAYLOAD`다.
- unknown required semantic은 capability mismatch다.

## Requirements

### Functional Requirements

- **FR-001**: lifecycle 5종을 discriminated union으로 표현하는 versioned envelope를 정의해야 한다.
- **FR-002**: envelope는 `contract_version`, `event_id`, `event_type`, `occurred_at`, `adapter_name`, `adapter_version`, `session_id`, `sequence_no`, `scope`, `payload`를 포함해야 한다.
- **FR-003**: `(adapter_name, event_id)`는 idempotency key이며 같은 key와 다른 redacted payload hash는 충돌이어야 한다.
- **FR-004**: sequence 역전은 허용하며 late arrival와 clock skew를 표현해야 한다.
- **FR-005**: session 상태 전이와 terminal grace-window를 정의해야 한다.
- **FR-006**: redaction은 serialization, hashing, persistence, logging, telemetry보다 먼저 수행되어야 한다.
- **FR-007**: secret·PII는 placeholder로, credential file·binary·private key는 fail-closed drop해야 한다.
- **FR-008**: redaction 후 event payload는 32KiB, batch는 50건 또는 512KiB로 제한해야 한다.
- **FR-009**: payload 축소는 event별 필수 필드를 보존하는 deterministic truncation이어야 한다.
- **FR-010**: 결과는 `accepted`, `redacted`, `duplicate`, `dropped`, `degraded`, `invalid`와 안정된 reason code를 구분해야 한다.
- **FR-011**: queue priority는 `STOP`·실패 tool > `PRE_COMPACT`·start > prompt > 성공 tool 순이어야 한다.
- **FR-012**: hook-facing 호출은 목표 50ms 안에 반환하고 server 작업을 기다리거나 예외를 전파하지 않아야 한다.
- **FR-013**: 신규 `@memento/agent-integration`은 wire contract, normalization, redaction/size policy, queue runtime을 소유해야 한다.
- **FR-014**: `@memento/assistant`는 기존 turn lifecycle API를 유지하고 신규 package에 의존하지 않아야 한다.
- **FR-015**: `@memento/client`는 agent API transport를 제공하되 adapter-specific 타입에 의존하지 않아야 한다.
- **FR-016**: `@memento/core`는 provenance 규칙을 소유하되 adapter payload와 HTTP 타입에 의존하지 않아야 한다.
- **FR-017**: server는 programmatic auth 아래 Start, Ingest, PreCompact, Stop, Get/List, Trace를 제공해야 한다.
- **FR-018**: additive migration으로 `agent_session`, `agent_observation`, `memory_provenance`를 추가하고 기존 `memory_item.session_id` 의미를 변경하지 않아야 한다.
- **FR-019**: rollback은 새 write 중지, 구버전 read compatibility, 신규 table 제거를 분리해야 한다.
- **FR-020**: capability discovery와 `UNSUPPORTED_CONTRACT_VERSION`을 제공해야 한다.
- **FR-021**: log/telemetry에 payload 원문, redaction 전 hash, secret fragment를 포함하지 않아야 한다.
- **FR-022**: 정상, duplicate, late, secret, PII, path, oversized, auth, timeout, overflow, migration mismatch fixture를 포함해야 한다.
- **FR-023**: 기존 MCP 도구, `/tools`, `@memento/assistant` 공개 API는 변경 없이 동작해야 한다.

### Key Entities

- **Agent Event Envelope**: versioned lifecycle wire contract.
- **Agent Session**: coding-agent 실행 구간과 상태·scope.
- **Agent Observation**: redaction·size 정책이 적용된 lifecycle 사건.
- **Memory Provenance**: memory와 source session/observation의 파생 관계.
- **Capture Result**: 처리 상태, reason code, observation 참조.
- **Capability Document**: 지원 version, event type, limit, feature.

## Success Criteria

- **SC-001**: lifecycle 5종 정상·오류 example이 공통 schema로 검증 가능하다.
- **SC-002**: secret fixture 원문이 persistence, log, telemetry에 나타나는 경우가 0건이다.
- **SC-003**: #454와 #461 scope가 package owner와 contract에 100% 매핑된다.
- **SC-004**: duplicate, late, timeout, auth, overflow의 결과와 reason code가 100% 결정된다.
- **SC-005**: 기존 MCP/assistant 공개 계약 breaking change가 0건이다.
- **SC-006**: spec, plan, model, contracts, tasks 간 미결정 항목이 0건이다.

## Assumptions

- contract major는 `1`, URI는 `/api/v1/agent/*`다.
- redacted observation payload 기본 retention은 30일(설정 범위 1~90일)이다.
- adapter는 opt-in 설치 후에만 전송한다.
- 실제 migration/runtime 구현은 #454와 #461 범위다.

## Out of Scope

- 실제 DB migration, repository, HTTP route, redaction engine, queue runtime
- Codex/Claude adapter, summary/promotion/injection, dashboard, CLI, benchmark 구현
