# Feature Specification: Agent Operations CLI

**Feature Branch**: `feature/issue-458-agent-ops-cli`
**Created**: 2026-06-07
**Status**: Ready for Implementation
**Input**: Issue #458, `tasks/0452-prd-agent-integration.md`, `specs/017-agent-integration-contracts`

## Problem

Agent adapter를 연결한 뒤에는 endpoint, 인증, schema, contract/version, redaction,
최근 capture 상태를 여러 로그와 API에서 수동으로 조합해야 한다. 사용자는 CLI만으로
설치 상태를 진단하고, 장애 reason code의 조치 방법을 확인하며, 두 세션 사이 자동 기억
주입이 실제로 동작하는지 재현할 수 있어야 한다.

## User Scenarios & Testing

### User Story 1 - 안전한 연결 진단 (Priority: P1)

운영자는 `memento doctor`로 endpoint, auth, server version, schema readiness, contract
compatibility와 redaction 경계를 한 번에 검증한다.

**Independent Test**: 가짜 secret marker를 가진 진단 세션을 생성하고 export 결과에서
marker가 사라졌는지 확인한 뒤 세션을 삭제한다. 출력에는 API key, marker, payload가
없어야 한다.

**Acceptance Scenarios**:

1. 정상 서버에서는 모든 필수 check가 `pass`이고 exit code가 0이다.
2. server down, auth failure, schema mismatch, contract mismatch는 서로 다른 reason
   code와 조치 가이드로 보고된다.
3. redaction test event는 고정된 비민감 marker만 사용하고 완료 후 삭제된다.
4. `--json` 결과는 안정된 machine-readable schema이며 secret/payload 원문이 없다.

### User Story 2 - 최근 운영 상태 확인 (Priority: P1)

운영자는 `memento status`로 최근 capture, injection, drop, degraded 상태와 원인을
payload 조회 없이 확인한다.

**Independent Test**: observation과 injection telemetry fixture를 생성한 뒤 운영 상태
endpoint가 집계와 제한된 최근 event metadata만 반환하는지 검증한다.

**Acceptance Scenarios**:

1. 최근 window의 capture/injection/drop/degraded count를 반환한다.
2. 최근 항목은 시각, event kind, status, reason code, session/adapter 식별 정보만 담는다.
3. payload, redaction metadata 원문, API key는 반환하지 않는다.
4. `--since`와 `--limit`은 안전한 범위로 제한된다.

### User Story 3 - 두 세션 자동 기억 데모 (Priority: P1)

설치자는 `memento demo`로 첫 세션의 수집과 종료 summary가 두 번째 세션 시작의
context injection으로 연결되는지 검증한다.

**Independent Test**: 고유 scope에서 SESSION_START → USER_PROMPT → TOOL_RESULT → STOP
후 새 SESSION_START를 전송하고 summary 생성과 initial injection을 검증한다.

**Acceptance Scenarios**:

1. 데모는 각 단계의 성공/실패와 안정된 reason code를 출력한다.
2. 두 번째 세션의 injection에 첫 세션에서 파생된 memory가 포함되면 통과한다.
3. 임시 세션은 성공과 실패 모두에서 정리된다.
4. 데모 입력과 출력에는 실제 repository 파일 내용이나 secret이 포함되지 않는다.

### User Story 4 - 호환성과 복구 가이드 (Priority: P2)

사용자는 CLI 결과에서 server contract와 Claude Code/Codex adapter의 지원 상태를
확인하고 reason code별 다음 조치를 바로 찾을 수 있다.

**Independent Test**: known/unknown contract와 대표 reason code fixture가 동일한 matrix와
가이드를 human/JSON 출력에서 제공하는지 검증한다.

## Requirements

### Functional Requirements

- **FR-001**: `memento doctor`, `memento status`, `memento demo`를 additive command로 제공해야 한다.
- **FR-002**: 공통 `--endpoint`, `--api-key`, `--json`, `--timeout-ms` 옵션을 지원해야 한다.
- **FR-003**: endpoint 기본값은 명시 옵션, 환경변수, server-info 순으로 안전하게 해석해야 한다.
- **FR-004**: API key는 명시 옵션 또는 `ADMIN_API_KEY`/`MEMENTO_API_KEY`에서 읽되 출력하지 않아야 한다.
- **FR-005**: doctor는 health, auth, schema, contract/version, redaction test를 개별 check로 보고해야 한다.
- **FR-006**: redaction test는 고정 synthetic marker만 사용하고 export에서 원문 부재와 `REDACTED` 상태를 확인해야 한다.
- **FR-007**: status는 payload-free 운영 summary endpoint를 사용해야 한다.
- **FR-008**: status는 capture, injection, drop, degraded 집계와 제한된 recent events를 제공해야 한다.
- **FR-009**: demo는 두 세션 lifecycle과 다음 세션 initial injection을 end-to-end 검증해야 한다.
- **FR-010**: doctor/demo의 임시 session은 finally cleanup해야 한다.
- **FR-011**: server contract 1과 Codex/Claude Code adapter 지원 matrix를 제공해야 한다.
- **FR-012**: 안정된 reason code별 한국어 수정 가이드를 human/JSON 출력에 제공해야 한다.
- **FR-013**: JSON 출력은 command, ok, checked_at, endpoint, checks/summary/steps,
  compatibility, guidance를 명시적으로 표현해야 한다.
- **FR-014**: stdout/stderr, server response, telemetry에 API key, synthetic marker,
  observation payload 원문을 노출하지 않아야 한다.
- **FR-015**: 신규 dependency를 추가하지 않아야 한다.
- **FR-016**: 기존 MCP, agent adapter, lifecycle API와 client 공개 계약을 깨지 않아야 한다.

## Edge Cases

- server-info가 없고 endpoint도 없으면 `SERVER_UNAVAILABLE`이다.
- health는 성공하지만 agent endpoint가 401이면 `AUTH_FAILED`다.
- capability의 `schema_ready=false`면 `SCHEMA_NOT_READY`다.
- contract version 1이 없으면 `UNSUPPORTED_CONTRACT_VERSION`이다.
- test event 생성 후 export 또는 cleanup만 실패해도 단계별 결과를 보존한다.
- status window는 미래/음수 값을 허용하지 않고 최대 7일, limit은 최대 100이다.
- injection이 empty/degraded이면 demo는 실패 reason과 guidance를 남긴다.
- human 출력도 payload나 marker를 재출력하지 않는다.

## Success Criteria

- **SC-001**: 정상 doctor의 필수 check가 100% 통과한다.
- **SC-002**: auth/server/schema/contract 장애 fixture가 서로 다른 reason code로 분류된다.
- **SC-003**: status 응답과 CLI 출력에서 secret marker 및 payload key 검색 결과가 0건이다.
- **SC-004**: demo fixture가 첫 session summary를 두 번째 session injection에서 확인한다.
- **SC-005**: human/JSON 출력의 reason code와 compatibility 결과가 일치한다.
- **SC-006**: targeted tests, lint, type-check와 security workflow 동등 검증이 통과한다.

## Out of Scope

- dashboard timeline/provenance UI와 transcript import
- benchmark corpus, graph-RRF 실험
- adapter hook 설치 방식 변경
- 신규 DB migration 또는 retention 정책 변경
- 실제 user secret을 이용한 redaction 테스트
