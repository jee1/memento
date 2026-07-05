# Feature Specification: HTTP Audit & Rate Limit

**Feature Branch**: `issue-663-http-audit-rate-limit`  
**Created**: 2026-07-05  
**Status**: Ready for Implementation  
**Input**: GitHub issue #663 — HTTP programmatic audit JSONL + express-rate-limit buckets

## User Scenarios & Testing

### User Story 1 - Programmatic call audit trail (Priority: P1)

운영자는 programmatic HTTP/MCP 호출마다 누가(key), 어떤 route/tool, owner/agent, latency, status가 JSONL로 남는지 확인할 수 있어야 한다.

**Acceptance Scenarios**:

1. **Given** `/tools/remember` POST with valid API key, **When** 응답이 완료되면, **Then** audit JSONL 한 줄에 필드 계약 `{ ts, key_id, route, tool, owner_id, agent_id, latency_ms, status }`가 기록된다.
2. **Given** append 실패, **When** `MEMENTO_HTTP_AUDIT_MODE=best-effort`(기본), **Then** 요청은 성공/실패 그대로 처리되고 stderr에만 경고한다.

### User Story 2 - Abuse mitigation rate limits (Priority: P1)

운영자는 `/tools/*`와 `/admin/*`에 독립 rate limit을 두어 burst를 완화할 수 있어야 한다.

**Acceptance Scenarios**:

1. **Given** tools bucket 한도 초과, **When** 추가 요청, **Then** `429` + `Retry-After` 헤더.
2. **Given** `NODE_ENV=test` 또는 `MEMENTO_HTTP_RATE_LIMIT_DISABLED=1`, **When** 테스트/비활성 환경, **Then** rate limit 미적용.

## Requirements

### Functional Requirements

- **FR-001**: programmatic 경로(`/tools`, `/api/v1/agent`, `/api/v1/quality`, `/mcp`, `/messages`)에 audit 미들웨어 적용.
- **FR-002**: audit 로그 기본 경로 `{dirname(DB_PATH)}/http-audit.jsonl`, override `MEMENTO_HTTP_AUDIT_LOG_PATH`.
- **FR-003**: `key_id` — `programmaticAuth.keyId` (#662) 우선, 없으면 credential hash 접두 또는 `legacy-key`/`session`/`anonymous`.
- **FR-004**: `/tools` 100/15min, `/admin` 30/15min 기본 bucket (`MEMENTO_HTTP_RATE_LIMIT_*`).

### Integration with #660

- 본 이슈는 **flat JSONL** append-only 감사의 1단계이다.
- #660 hash-chained audit은 동일 필드에 `previous_hash`, `current_hash`, `transport`, `action` 등을 추가한다.
- 중복 구현 방지: #663 필드명·의미를 #660 스키마 초안과 정렬하고, #660 merge 시 audit writer를 단일화한다.

## Success Criteria

- programmatic 호출 100% audit JSONL (best-effort 정책 문서화)
- rate limit 429 + Retry-After
- security.md + env.example + CHANGELOG 반영
