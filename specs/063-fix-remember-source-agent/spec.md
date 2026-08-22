# Feature Specification: remember source agent 식별자 허용

**Feature Branch**: `issue-696-remember-source-agent`  
**Created**: 2026-07-24  
**Status**: Draft  
**Issue**: [#696](https://github.com/jee1/memento/issues/696) — App warning: remember source 형식 (`source='paperclip-ceo-heartbeat'`)

## Problem

운영 로그 모니터가 `remember` WARN을 3회 감지했다. Paperclip 등 에이전트가 `source`에 워크플로/에이전트 식별자(`paperclip-ceo-heartbeat`)를 넘기는데, `#671` URI 표준(`file://`, `https://`, `commit:`, `doc:`, `memento://memory/`)만 허용해 기본(관대) 모드에서도 매번 WARN이 쌓인다. 저장은 계속되지만 provenance가 스키마화되지 않고 운영 노이즈만 발생한다.

## User Scenarios & Testing

### User Story 1 — 에이전트/워크플로 식별자는 경고 없이 저장 (Priority: P1)

에이전트가 `source: "paperclip-ceo-heartbeat"` 또는 `source: "agent:paperclip-ceo-heartbeat"`로 remember를 호출하면, 서버는 WARN 없이 저장하고 provenance는 `agent:` URI로 기록한다.

**Why this priority**: #696 운영 노이즈의 직접 원인.

**Independent Test**: `validateSource('paperclip-ceo-heartbeat')`가 valid이며 `normalizedSource === 'agent:paperclip-ceo-heartbeat'`.

**Acceptance Scenarios**:

1. **Given** bare agent id (`paperclip-ceo-heartbeat`), **When** `validateSource`, **Then** `isValid=true`, `type=agent`, `normalizedSource=agent:paperclip-ceo-heartbeat`.
2. **Given** `agent:paperclip-ceo-heartbeat`, **When** `validateSource`, **Then** `isValid=true`, `type=agent`, 정규화 불필요.
3. **Given** remember에 bare agent id, **When** 저장, **Then** DB `source`가 `agent:…`이고 WARN 로그 없음.

### User Story 2 — 비식별자 free-text는 기존 정책 유지 (Priority: P2)

공백·특수문자가 포함된 free-text `source`는 기존처럼 invalid다. 관대 모드에서는 WARN 후 저장, strict에서는 거절.

**Acceptance Scenarios**:

1. **Given** `source: "just a note"`, **When** `validateSource`, **Then** `isValid=false`.
2. **Given** 기존 `file://`·`https://`·`commit:`·`doc:`·`memento://` URI, **When** 검증, **Then** 기존과 동일하게 valid.

## Requirements

- **FR-001**: `agent:<id>` URI를 지원한다. `<id>`는 `doc:`와 동일 charset (`[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}`).
- **FR-002**: 동일 charset의 bare 식별자는 `agent:<id>`로 정규화하고 valid로 처리한다.
- **FR-003**: remember는 `normalizedSource`가 있으면 그 값을 저장한다.
- **FR-004**: 정규화된 agent source에 대해 WARN/ERROR를 남기지 않는다.
- **FR-005**: `docs/reference/ko/source-field.md`에 `agent:` 및 bare 정규화를 문서화한다.
- **FR-006**: 기존 URI 5종 동작·strict 모드는 유지한다.

## Out of Scope

- Paperclip 클라이언트 코드 수정 (외부)
- 기존 DB에 저장된 bare free-text의 일괄 마이그레이션
- 새 env 플래그

## Success Criteria

- **SC-001**: `paperclip-ceo-heartbeat` remember 시 WARN 0건, `source=agent:paperclip-ceo-heartbeat` 저장
- **SC-002**: `source-uri.spec.ts` 및 관련 게이트 통과
- **SC-003**: `npm run lint`, `npm run type-check`, 관련 `npm test` 통과
- **SC-004**: CHANGELOG Unreleased 항목 추가
