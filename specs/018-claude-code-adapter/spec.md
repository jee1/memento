# Feature Specification: Claude Code Adapter

**Feature Branch**: `feature/issue-457-claude-code-adapter`
**Created**: 2026-06-07
**Status**: Ready for Implementation
**Input**: Issue #457, `tasks/0452-prd-agent-integration.md`, `specs/017-agent-integration-contracts`

## User Scenarios

### P1 - Lifecycle 자동 수집

Claude Code 사용자는 `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `Stop` 이벤트가 공통 `AgentEventEnvelope`로 변환되어 수동 `remember` 없이 전송되길 원한다.

### P1 - 기존 설정 보존 연결

사용자는 `memento connect claude-code` 실행 시 기존 `~/.claude/settings.json`의 권한, 플러그인, hook을 보존하고 Memento hook만 정확히 한 번 추가하길 원한다.

### P1 - 장애 격리

Memento가 중단되거나 입력이 잘못되어도 Claude Code hook은 항상 성공 종료하여 주 작업을 막지 않아야 한다.

## Requirements

- **FR-001**: Claude Code 2.1.153의 lifecycle 5종 payload를 계약 v1 envelope로 정규화한다.
- **FR-002**: `MEMENTO_*` 환경값을 우선하고 git remote/branch/cwd로 project/process scope를 보완한다.
- **FR-003**: 원본 설정을 보존하는 deterministic merge, 변경 diff, 변경 시 backup, atomic write를 제공한다.
- **FR-004**: 같은 설정에 재연결하면 변경과 중복 hook이 없어야 한다.
- **FR-005**: malformed payload와 transport 오류는 throw하지 않고 exit code 0과 안정된 결과를 반환한다.
- **FR-006**: 버전, lifecycle capability, `--include-hook-events` 지원 차이를 진단한다.
- **FR-007**: 실제 사용자 홈은 테스트에서 수정하지 않는다.

## Success Criteria

- lifecycle fixture 5종 모두 schema validation을 통과한다.
- 기존 설정 fixture가 byte-preserving backup으로 남고 비-Memento 필드는 유지된다.
- 두 번째 연결 plan은 `changed=false`다.
- transport 장애 smoke에서 exit code 0이다.
- 기존 공개 계약과 dependency 목록은 변경하지 않는다.

## Out of Scope

- Claude Code 자체 설치/업데이트
- 실제 사용자 홈을 대상으로 한 테스트
- context injection 응답 작성
