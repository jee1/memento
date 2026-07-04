# Feature Specification: core-deprecated-inventory API 제거 (v1.18+)

**Feature Branch**: `issue-636-deprecated-api-removal`  
**Created**: 2026-07-04  
**Status**: Draft  
**Input**: GitHub Issue #636 — chore(deprecation): core-deprecated-inventory API 제거 (v1.18+)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — MCP `type` 파라미터 필수화 (Priority: P1)

에이전트·클라이언트가 `remember` / `recall` 호출 시 `type`을 생략하면 기본값 `episodic` 대신 명시적 오류가 반환되어야 한다.

**Independent Test**: `type-param-validator.spec.ts`, `remember-tool.spec.ts`, `recall-tool.spec.ts`

**Acceptance Scenarios**:

1. **Given** `MEMENTO_TYPE_PARAM_MODE` 미설정, **When** `remember`에 `type` 없이 호출, **Then** 거절(에러 메시지).
2. **Given** `MEMENTO_TYPE_PARAM_MODE=warn`, **When** `type` 없이 호출, **Then** 기존 warn 동작 유지(마이그레이션용).
3. **Given** inventory 잔여 항목, **When** 구현 완료, **Then** `[LEGACY TYPE]` 프로덕션 문자열 제거.

### User Story 2 — 문서·인벤토리 정합성 (Priority: P1)

`core-deprecated-inventory.md` 활성 표가 비어 있고, 제거 항목이 Removed 섹션에 기록되어야 한다.

**Acceptance Scenarios**:

1. **Given** 구현 완료, **When** inventory 조회, **Then** 활성 deprecated 항목 0건.
2. **Given** CHANGELOG Unreleased, **When** 릴리스 노트 확인, **Then** breaking change 항목 존재.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `MEMENTO_TYPE_PARAM_MODE` 기본값을 `error`로 전환 (`environment.ts`, `parseTypeParamMode`).
- **FR-002**: `deprecate` 모드 메시지에서 `[LEGACY TYPE]` 마커 제거(명시적 `deprecate` 설정 시에만 경고).
- **FR-003**: `core-deprecated-inventory.md` 갱신 — 잔여 항목 Removed in #636으로 이동.
- **FR-004**: `CHANGELOG.md` Unreleased에 breaking change 기록.
- **FR-005**: `docs/guides/ko/type-param-rollout.md` 기본값 설명 갱신.

## Out of Scope

- Repository shim 등 #617에서 이미 제거된 항목 재작업
- `eslint` 8→10, `vitest` 4.x major 업그레이드

## Success Criteria *(mandatory)*

- **SC-001**: `npm run check-debt-markers -- --production-only` 통과
- **SC-002**: `npm run lint && npm run type-check && npm test` 통과
- **SC-003**: Issue #636 완료 기준 4항목 충족
