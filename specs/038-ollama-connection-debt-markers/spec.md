# Feature Specification: ollama-connection.spec.ts TODO 정리

**Feature Branch**: `038-ollama-connection-debt-markers`  
**Created**: 2026-07-04  
**Status**: Draft  
**Input**: GitHub Issue #638 — `ollama-connection.spec.ts` TODO/FIXME 정리

## User Scenarios & Testing *(mandatory)*

### User Story 1 — GREEN 단계 검증 활성화 (Priority: P1)

유지보수자가 Ollama 연결 실패 시나리오 테스트를 실행할 때, `initialize()`가 async로 동작하고 `logger.warn`·`result.warnings`가 실제 구현과 일치하는지 검증해야 한다.

**Independent Test**: `ollama-connection.spec.ts` 4건 통과 + 파일 내 TODO 0건.

**Acceptance Scenarios**:

1. **Given** Ollama HTTP 비-200 응답, **When** `initialize()` 호출, **Then** `logger.warn` 호출 및 `warnings`에 HTTP 실패 메시지 포함.
2. **Given** Ollama 연결 타임아웃, **When** `initialize()` 호출, **Then** `logger.warn` 호출 및 `warnings`에 타임아웃 메시지 포함.
3. **Given** Ollama 네트워크 에러, **When** `initialize()` 호출, **Then** `logger.warn` 호출 및 `warnings`에 네트워크 에러 메시지 포함.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `ollama-connection.spec.ts`의 TODO 6건 제거.
- **FR-002**: 실패 시나리오 3건에서 `loggerWarnSpy`·`result.warnings` 내용 검증 활성화.
- **FR-003**: RED 단계 outdated 주석 정리(구현 완료 반영).

## Out of Scope

- `llm-client-initializer.ts` 프로덕션 로직 변경
- 다른 llm-client-initializer 테스트 파일의 TODO

## Success Criteria *(mandatory)*

- **SC-001**: Issue #638 완료 조건 충족 (CI green, `Fixes #638`)
- **SC-002**: `npm test -- .../ollama-connection.spec.ts` 통과
- **SC-003**: 대상 파일 `check-debt-markers` TODO 0건
