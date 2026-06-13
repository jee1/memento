# Feature Specification: Agent Adapter Smoke Matrix

**Feature Branch**: `feature/484-agent-smoke-matrix`
**Created**: 2026-06-13
**Status**: Ready for Implementation
**Input**: Issue #484, Epic #452, `tasks/0452-prd-agent-integration.md`

## Problem

fixture replay와 unit test만으로는 Codex CLI·Claude Code의 실제 설치, connect idempotency,
lifecycle capture, 장애 fallback, 운영 CLI 흐름이 출시 가능하다고 주장할 수 없다.
운영자는 machine-readable smoke matrix와 실패 시 진단 절차가 필요하다.

## User Scenarios & Testing

### User Story 1 - 자동화 smoke matrix (Priority: P1)

릴리스 담당자는 CI와 로컬에서 `npm run quality:agent-smoke`를 실행해 adapter 호환성
증거 JSON을 생성한다.

**Independent Test**: Codex/Claude CLI가 설치된 환경에서 connect, lifecycle replay,
failure fallback, ops CLI double 검증이 `ok: true`로 끝나면 통과.

**Acceptance Scenarios**:

1. lifecycle 5종 fixture가 adapter runtime을 통해 normalized event로 전달된다.
2. connect는 기존 설정 보존, backup, hook 5개, reconnect idempotency를 검증한다.
3. server down/auth/timeout에서 hook은 exit 0과 non-blocking을 유지한다.
4. live server/agent가 없으면 skip과 reason_code로 기록하고 실패로 위장하지 않는다.

### User Story 2 - 실제 독립 서버 검증 (Priority: P1)

운영자는 `MEMENTO_SMOKE_ENDPOINT`로 doctor/status/demo human·JSON을 검증한다.

**Acceptance Scenarios**:

1. `--require-live` 없이 endpoint 미설정 시 LIVE_SERVER_NOT_CONFIGURED skip.
2. endpoint 설정 시 doctor/status/demo가 synthetic session을 생성·정리한다.

### User Story 3 - controlled live agent session (Priority: P2)

릴리스 환경에서는 문서화된 controlled runner로 실제 prompt session evidence를 첨부한다.

## Requirements

### Functional Requirements

- **FR-001**: `scripts/agent-smoke-matrix.ts`가 schema_version 1 JSON report를 생성해야 한다.
- **FR-002**: codex, claude_code adapter별 connect/lifecycle/failure/cli 검증을 포함해야 한다.
- **FR-003**: compatibility matrix에 OS, Node, agent version, server version, result를 기록해야 한다.
- **FR-004**: skip 항목은 안정적인 reason_code와 action을 포함해야 한다.
- **FR-005**: `docs/operations/ko/agent-smoke-matrix.md`에 재현 절차와 진단 가이드를 제공해야 한다.
- **FR-006**: `quality:agent-smoke:test` Vitest로 deterministic subset을 검증해야 한다.

## Success Criteria

- **SC-001**: 기본 smoke 실행이 `ok: true`이다 (live skip 허용).
- **SC-002**: issue #484 수용 기준의 자동화 가능 항목이 report에 매핑된다.
- **SC-003**: lint, type-check, targeted tests가 통과한다.
