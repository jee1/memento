# Feature Specification: PIIMasker 전화번호 경계 부재로 epoch·memory_id 파괴

**Feature Branch**: `feature/fix-logging-piimasker-epoch-memory_id-phone`
**Spec Directory**: `specs/667-854-fix-logging-piimasker-epoch-memory_id-phone`
**Created**: 2026-09-06
**Status**: Executed — review PASS
**Issue**: [#854](https://github.com/jee1/memento/issues/854)
**Related**: [#861](https://github.com/jee1/memento/issues/861) (라이브 `searchId` 파괴 재확인)
**Input**: fix(logging): PIIMasker 전화번호 정규식에 경계가 없어 epoch 타임스탬프·memory_id 를 [PHONE] 으로 파괴 — 로그 추적 불가

## Problem Statement

운영 로그의 `memory_id` / `event_id` / `searchId` / 타임스탬프가 `[PHONE]` 으로
잘려 나와 한 요청을 로그로 추적할 수 없다.

원인: 한국 전화번호 마스킹 규칙이 **더 긴 숫자열 내부**에서도 매치한다.
현재 epoch-ms(13자리, `17…` 시작)는 항상 이 규칙에 걸린다. 로거는 모든
메시지·메타데이터를 이 마스커에 통과시키므로 특정 호출부 문제가 아니다.

## Goals

- 식별자·epoch 타임스탬프·포트/버전 숫자열이 로그에서 **그대로** 보존된다.
- 실제 한국/국제 전화번호는 계속 `[PHONE]` 으로 마스킹된다.
- 회귀는 자동 테스트로 고정된다 (다시 경계 없는 패턴으로 돌아가면 실패).

## Non-Goals

- 로거 파이프라인 재설계 또는 PII 마스킹 on/off 정책 변경.
- `memento-agent-integration` redaction 규칙을 core 로 통합하는 대규모 리팩터.
- email / api_key / 기타 PII 타입 패턴 전면 재작성.
- 이미 DB 이력에 영속된 손상 문자열의 일괄 복구 마이그레이션.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 로그에서 memory_id·searchId 추적 가능 (Priority: P1)

운영자/개발자가 로그에서 `mem_<epoch>_<suffix>`, `search_<epoch>_<suffix>`,
`failure_..._<epoch>` 형태의 ID를 보고 한 요청의 시작·벡터·텍스트·결과
라인을 서로 연결한다.

**Why this priority**: 지금 증상은 모든 해당 로그 라인이 같은 `[PHONE]`
접두사로 붕괴되어 추적이 무효화된다.

**Independent Test**: 마스커에 위 ID 문자열을 넣었을 때 원문이 보존되는지
단위 테스트로 확인.

**Acceptance Scenarios**:

1. **Given** `mem_1788581911067_d7yc4k698`, **When** 마스킹하면, **Then** 원문 전체가 보존되고 `[PHONE]` 이 없다.
2. **Given** `search_1788598782002_s53nhvc67`, **When** 마스킹하면, **Then** 원문이 보존된다.
3. **Given** `failure_remember_tool_error_41c0d83a_1788581877628`, **When** 마스킹하면, **Then** epoch 구간이 `[PHONE]` 으로 바뀌지 않는다.

---

### User Story 2 - 실제 전화번호는 계속 가려진다 (Priority: P1)

사용자 콘텐츠·로그 메타에 들어간 한국/국제 전화번호는 여전히 마스킹된다.

**Why this priority**: 경계를 너무 느슨하게 풀면 PII 회귀가 난다.

**Independent Test**: `010-1234-5678`, `01012345678`, `+82-10-1234-5678` 및
일반적인 `+1-234-567-8900` 형태가 `[PHONE]` 이 되는지 검증.

**Acceptance Scenarios**:

1. **Given** `010-1234-5678` 또는 `01012345678`, **When** 마스킹하면, **Then** `[PHONE]` 이고 원 번호는 없다.
2. **Given** `+82-10-1234-5678`, **When** 마스킹하면, **Then** `[PHONE]` 이다.
3. **Given** 국제 형식 `+1-234-567-8900`, **When** 마스킹하면, **Then** `[PHONE]` 이다.

---

### User Story 3 - 포트·버전 등 비전화 숫자열 보존 (Priority: P2)

포트·버전·기타 10자리 전후 숫자열이 전화번호로 오인되지 않는다.

**Why this priority**: 이슈 재현 예(`포트 18000 및 1234567890`)가 이미 깨진다.

**Independent Test**: 해당 문자열 마스킹 후 원문 보존.

**Acceptance Scenarios**:

1. **Given** `포트 18000 및 1234567890`, **When** 마스킹하면, **Then** 원문이 보존되고 `[PHONE]` 이 없다.
2. **Given** 경로/파일명에 epoch-ms 가 포함된 문자열, **When** 마스킹하면, **Then** 숫자열이 잘리지 않는다.

---

### Edge Cases

- 전화번호 앞뒤에 문자가 붙어 있어도 (`연락처:010-1234-5678`) 마스킹되어야 한다 (선행/후행 숫자가 아닐 때).
- 숫자열 **내부**에 끼인 유사 패턴은 매치하지 않는다 (epoch 내부).
- 국제 패턴이 긴 숫자열 **끝부분**만 잘라 `[PHONE]` + 잔여 숫자를 만들지 않는다.
- phone 타입이 비활성(env)이면 기존처럼 마스킹하지 않는다 (기존 계약 유지).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 마스커는 13자리 epoch-ms 및 이를 포함하는 시스템 식별자(`mem_*`, `search_*`, `failure_*` 등)를 전화번호로 취급하지 않아야 한다.
- **FR-002**: 마스커는 한국 휴대전화(010/011/016/017/018/019 및 `+82` 국제 표기)를 계속 마스킹해야 한다.
- **FR-003**: 마스커는 국제 전화번호 마스킹 시 더 긴 숫자열의 부분 절단을 만들지 않아야 한다 (후행 숫자 경계).
- **FR-004**: 로거가 메시지/메타에 마스커를 적용하는 경로는 유지하되, FR-001~003 결과에 따라 로그 추적성이 복구되어야 한다 (호출부 개별 우회 금지).
- **FR-005**: FR-001~003 은 자동 회귀 테스트로 고정되어야 한다.

### Success Criteria

- **SC-001**: 이슈에 나온 재현 문자열 3종(`mem_…`, `failure_…`, `포트 …`)이 마스킹 후 원문 보존.
- **SC-002**: `search_<epoch13>_<suffix>` 가 마스킹 후 원문 보존 (#861 라이브 사례).
- **SC-003**: 기존 전화 마스킹 스모크(`010-1234-5678` 등)가 계속 통과.
- **SC-004**: 관련 단위 테스트가 CI에서 green; lint / type-check / 해당 스펙 테스트 통과.

## Assumptions

- 수정 지점은 공유 마스커 한 곳이며, 개별 logger 호출부 패치는 불필요 (이슈 분석과 동일).
- 한국 휴대전화는 선행 `0` 또는 `+82` 표기를 요구하는 쪽이 안전하다 (이슈 제안·Q1).
- agent-integration redaction 패턴은 **참고**만 하고, core 마스커 API/placeholder 계약을 깨지 않는다.

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | 한국 패턴에 선행 `0`/`+82` 강제 vs lookaround만? | Resolved | 이슈 제안: `(?<![0-9])(?:\+82[-.\s]?1[0-9]\|01[0-9])…(?![0-9])` — 선행 강제 + 숫자 경계 |
| Q2 | international 패턴도 함께 고칠까? | Resolved | 예 — 후행 `(?![0-9])` (및 필요 시 선행) 추가 |
| Q3 | agent-integration 패턴으로 교체? | Resolved | 아니오 — core API/`[PHONE]` 유지, 경계 철학만 정렬 |
| Q4 | 영속된 migration 이력 손상 문자열 복구? | Resolved | Non-Goal — 이번 범위 밖 |

## Brainstorm Log

### 2026-09-06 — Session 1 (auto-select recommended)

- Categories: Boundary, Security/privacy (over-redaction), Compatibility.
- Insights: epoch `17…` 는 현시점 항상 매치 → 확률 사고 아님. 로거 우회보다 마스커 한 곳 수정이 최소 diff.
- Spec updates: Open Questions Q1–Q4 Resolved; Status=Brainstormed.
- Next: `/speckit.plan` → tasks → execute.
