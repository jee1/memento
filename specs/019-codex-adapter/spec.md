# Feature Specification: Codex Lifecycle Adapter

**Feature Branch**: `feature/issue-459-codex-adapter`  
**Created**: 2026-06-07  
**Status**: Ready for Implementation  
**Input**: Issue #459, `tasks/0452-prd-agent-integration.md`, `specs/017-agent-integration-contracts`

## Problem

Codex CLI lifecycle payload는 Memento 공통 `AgentEventEnvelope`와 형식이 다르고,
사용자 `~/.codex/hooks.json`에는 다른 도구의 hook과 trust state가 이미 존재할 수 있다.
사용자는 기존 설정을 잃지 않고 Codex를 연결하고, Memento 장애 시에도 Codex 작업을
계속할 수 있어야 한다.

## User Scenarios & Testing

### User Story 1 - Lifecycle 자동 수집 (Priority: P1)

사용자는 Codex CLI의 `SessionStart`, `UserPromptSubmit`, `PostToolUse`,
`PreCompact`, `Stop` 이벤트가 수동 `remember` 호출 없이 Memento 공통 계약으로
정규화되기를 원한다.

**Independent Test**: Codex 0.137.0 형식 fixture 5종을 replay해 공통 envelope의
event type, session, scope, payload를 검증한다.

**Acceptance Scenarios**:

1. 각 지원 hook payload를 입력하면 대응하는 공통 lifecycle event가 생성된다.
2. 동일 payload를 재실행하면 동일 event ID가 생성되어 ingest idempotency를 유지한다.
3. cwd, turn, session 정보로 project/process/session scope가 채워진다.
4. 필수 필드가 없거나 알 수 없는 hook이면 안정된 진단 결과를 반환하고 throw하지 않는다.

### User Story 2 - 기존 설정 보존 연결 (Priority: P1)

사용자는 `memento connect codex` 실행 시 기존 hook, matcher, handler, state 및 알 수
없는 최상위 필드가 보존되고 Memento handler만 정확히 한 번 추가되기를 원한다.

**Independent Test**: 임시 `hooks.json` fixture에 connect를 두 번 적용해 두 번째 diff가
없고, 기존 JSON subtree가 동일하며, 첫 적용의 backup과 diff plan을 검증한다.

**Acceptance Scenarios**:

1. 기존 파일이 있으면 쓰기 전에 timestamp backup을 만든다.
2. 기존 event group과 handler 순서를 보존한 채 Memento command handler를 추가한다.
3. 재연결 시 handler가 중복되지 않고 backup도 불필요하게 생성하지 않는다.
4. dry-run은 변경 diff와 backup 예정 위치만 출력하고 파일을 수정하지 않는다.
5. malformed JSON은 원본을 덮어쓰지 않고 명시적 오류로 종료한다.

### User Story 3 - 장애 격리와 capability 진단 (Priority: P1)

사용자는 Codex 또는 Memento 버전 차이와 서버 장애를 진단할 수 있어야 하며, hook
runner 실패가 Codex 본 작업을 중단시키지 않아야 한다.

**Independent Test**: unsupported version/disabled hooks/server failure fixture에서 runner가
exit code 0과 bounded 결과를 반환하고 connect 진단이 mismatch를 표시하는지 검증한다.

**Acceptance Scenarios**:

1. `codex --version`과 `codex features list` 결과에서 version과 stable hooks를 진단한다.
2. 요구 event가 현재 설정/지원 matrix에 없으면 capability mismatch를 출력한다.
3. stdin parse, normalization, network, auth 실패가 발생해도 hook runner는 throw하지 않는다.
4. runner는 stdout에 Codex 동작을 차단하는 output을 쓰지 않는다.

## Requirements

### Functional Requirements

- **FR-001**: Codex CLI 0.137.0의 지원 event/version matrix를 문서화해야 한다.
- **FR-002**: lifecycle 5종 원본 payload를 `AgentEventEnvelope`로 정규화해야 한다.
- **FR-003**: event ID는 동일 payload replay에서 결정적이어야 한다.
- **FR-004**: project/process/session scope를 환경 override와 payload/cwd에서 탐지해야 한다.
- **FR-005**: adapter-specific payload 해석은 `@memento/agent-integration`에 한정해야 한다.
- **FR-006**: `memento connect codex`는 hooks config를 idempotent merge해야 한다.
- **FR-007**: 기존 JSON 전체를 보존하고 실제 변경 전에 backup과 diff plan을 제공해야 한다.
- **FR-008**: `memento hook codex` runner는 stdin JSON을 처리하고 절대 예외를 전파하지 않아야 한다.
- **FR-009**: runner는 lifecycle별 agent API endpoint로 전송해야 한다.
- **FR-010**: version, hooks feature, required event mismatch를 진단해야 한다.
- **FR-011**: 최소 5개 lifecycle fixture replay와 connect/runner smoke test를 제공해야 한다.
- **FR-012**: 실제 사용자 홈은 테스트에서 수정하지 않고 임시 경로만 사용해야 한다.
- **FR-013**: 신규 dependency를 추가하지 않아야 한다.
- **FR-014**: 기존 MCP, assistant, agent API 계약을 변경하지 않아야 한다.

## Edge Cases

- hooks file이 없으면 `{"hooks":{}}`에서 시작한다.
- `state`와 미지원 event(`PostCompact`, `SubagentStart` 등)는 그대로 보존한다.
- 같은 event group 안에 동일 command가 이미 있으면 새 group을 만들지 않는다.
- 다른 matcher의 동일 command도 Memento handler로 인식해 중복 추가하지 않는다.
- `transcript_path`가 null이어도 정규화한다.
- subagent 공통 필드가 있으면 process scope에 반영하되 별도 lifecycle로 확장하지 않는다.
- PostToolUse response가 구조화되지 않아도 redaction/size pipeline이 처리 가능한 unknown으로 보존한다.
- `codex exec`와 interactive TUI의 event coverage 차이는 capability 위험으로 보고한다.

## Success Criteria

- **SC-001**: lifecycle fixture 5종이 100% 유효한 공통 envelope로 변환된다.
- **SC-002**: connect 2회 실행 후 Memento handler 중복이 0건이다.
- **SC-003**: 기존 hooks fixture의 비-Memento subtree 변경이 0건이다.
- **SC-004**: runner failure fixture의 throw 및 non-zero exit가 0건이다.
- **SC-005**: lint, type-check, tests, 기존 security static gate가 통과한다.

## Out of Scope

- `PreToolUse`, `PermissionRequest`, `PostCompact`, subagent 전용 lifecycle 수집
- Codex trust 승인 자동화
- 사용자 config hot reload
- Codex 자체 hook 누락/dispatcher 버그 수정
- 신규 server API 또는 DB schema

