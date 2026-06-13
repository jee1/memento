# Feature Specification: MCP remember 검증 오류 처리

**Feature Branch**: `023-fix-remember-mcp-validation`  
**Created**: 2026-06-13  
**Status**: Draft  
**Input**: GitHub Issue #444 — `remember` 호출 시 `content` 누락 등 Zod 검증 실패가 streamable HTTP outer catch로 전파되어 ERROR 로그가 발생

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 잘못된 도구 인자는 클라이언트 오류로 응답 (Priority: P1)

MCP 클라이언트(Cursor, Claude Code 등)가 `tools/call`로 `remember` 등 도구를 호출할 때 필수 파라미터(`content` 등)가 없으면, 서버는 JSON-RPC `-32602 Invalid params` 오류를 반환하고 클라이언트가 인자를 수정해 재시도할 수 있어야 한다.

**Why this priority**: 현재는 내부 검증 실패가 `-32603 Internal error`와 ERROR 로그로 처리되어 운영 노이즈와 잘못된 진단을 유발한다.

**Independent Test**: streamable HTTP `POST /mcp`에 `content` 없이 `remember`를 호출하면 응답 `error.code === -32602`이고 `MCP streamable_http processing failed` ERROR 로그가 없다.

**Acceptance Scenarios**:

1. **Given** MCP streamable HTTP 엔드포인트가 준비됨, **When** `tools/call`로 `remember`에 `content` 없이 호출, **Then** JSON-RPC `-32602`/`Invalid params`가 반환된다.
2. **Given** 동일 조건, **When** 응답 처리, **Then** 서버 ERROR 로그(`MCP streamable_http processing failed`)가 기록되지 않는다.
3. **Given** 존재하지 않는 도구 이름, **When** `tools/call` 실행, **Then** JSON-RPC 클라이언트 오류(매핑된 code/message)가 반환되고 outer catch로 전파되지 않는다.

---

### User Story 2 — 예상치 못한 서버 오류는 기존과 동일 (Priority: P2)

DB 장애 등 검증·알 수 없는 도구 이외의 실행 오류는 기존처럼 outer catch에서 `-32603`으로 처리된다.

**Independent Test**: 매핑 대상이 아닌 Error를 throw하면 outer catch가 호출된다(단위 테스트).

**Acceptance Scenarios**:

1. **Given** `executeTool`이 일반 Error를 throw, **When** `processMcpMessage` tools/call 처리, **Then** 매핑되지 않고 re-throw되어 streamable HTTP outer catch가 `-32603`을 반환한다.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `processMcpMessage`의 `tools/call` 분기는 `executeTool`을 try/catch로 감싸야 한다.
- **FR-002**: `ZodError`는 JSON-RPC `-32602`/`Invalid params`로 매핑하고 `data`에 검증 상세를 포함해야 한다.
- **FR-003**: `Unknown tool: …` 오류는 JSON-RPC 클라이언트 오류로 매핑하고 outer catch로 전파하지 않아야 한다.
- **FR-004**: 매핑된 오류는 `logger.warn('MCP tools/call rejected invalid params', { tool, error })`로 기록해야 한다.
- **FR-005**: 매핑되지 않은 오류는 re-throw하여 기존 outer catch 동작을 유지해야 한다.

## Out of Scope

- `remember` Zod 스키마 자체 변경
- stdio/WebSocket MCP 경로 동일 처리(본 이슈는 streamable HTTP)
- MCP 프로토콜 버전·capabilities 변경

## Success Criteria *(mandatory)*

- **SC-001**: `content` 누락 `remember` 호출 시 `-32602` 응답, ERROR 로그 0건
- **SC-002**: `mapToolExecutionErrorToJsonRpc` 단위 테스트 통과
- **SC-003**: `npm run lint`, `npm run type-check`, `npm test` 통과
