# Feature Specification: HTTP Scoped API Tokens

**Feature Branch**: `issue-662-http-scoped-tokens`  
**Created**: 2026-07-05  
**Issue**: [#662](https://github.com/jee1/memento/issues/662)

## Problem

단일 `ADMIN_API_KEY`는 모든 programmatic HTTP 표면(`/tools`, `/mcp`, `/api/v1/quality` 등)에 동일 권한을 부여합니다. 에이전트·자동화 클라이언트에는 `tools:invoke`만, 품질·파괴적 admin API에는 `admin:destructive`만 필요합니다.

## User Scenarios

### User Story 1 — 도구 전용 토큰 (P1)

운영자가 MCP/도구 호출 전용 토큰을 발급하면 `/tools`, `/mcp`, `/api/v1/agent`만 접근 가능하고 `/api/v1/quality`는 403입니다.

### User Story 2 — Admin programmatic 토큰 (P1)

`admin:destructive` 스코프 토큰은 quality API와 tools 표면 모두 접근 가능합니다.

### User Story 3 — Legacy ADMIN_API_KEY (P2)

`MEMENTO_API_TOKENS` 미설정 시 기존 `ADMIN_API_KEY`는 synthetic `legacy-admin` 토큰으로 양쪽 스코프를 유지하며 deprecation 경고 1회를 남깁니다.

## Requirements

- **FR-001**: `MEMENTO_API_TOKENS` JSON 배열 — `{ id, secret, scopes[] }`.
- **FR-002**: 스코프 enum — `tools:invoke`, `admin:destructive`.
- **FR-003**: 라우트별 최소 스코프 — tools/mcp/agent → `tools:invoke`; quality → `admin:destructive`.
- **FR-004**: 스코프 부족 시 403, 미인증/잘못된 토큰 401.
- **FR-005**: legacy `ADMIN_API_KEY` synthetic token + startup deprecation warn once.
- **FR-006**: integration test scoped token matrix; docs/security.md 갱신.

## Out of Scope

- SQLite `api_keys` 테이블
- per-user OAuth / JWT refresh
- Admin UI 토큰 발급 화면

## Success Criteria

- tools-only 토큰: `/tools` 200, `/api/v1/quality/*` 403
- admin 토큰·legacy key: 양쪽 200
- lint, type-check, server tests green
