# Feature Specification: MCP SDK·better-sqlite3 등 의존성 업데이트

**Feature Branch**: `issue-637-deps-update`  
**Created**: 2026-07-04  
**Status**: Draft  
**Input**: GitHub Issue #637 — chore(deps): MCP SDK·better-sqlite3 등 의존성 업데이트

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 보안·호환 패치 적용 (Priority: P1)

우선순위 패키지를 minor/patch 범위에서 최신 wanted 버전으로 올린다.

**Independent Test**: `npm outdated`, `npm audit`, CI quality gates

**Acceptance Scenarios**:

1. **Given** lockfile 갱신, **When** `npm audit`, **Then** 0 vulnerabilities.
2. **Given** native 모듈 업데이트, **When** `npm run rebuild-native`, **Then** 성공.
3. **Given** 업데이트 완료, **When** `npm test`, **Then** 전체 통과.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `better-sqlite3` 12.4 → 12.11 (root + memento-server).
- **FR-002**: `@playwright/test`, `cors`, `axios`(client), `@typescript-eslint/*`, `tsx`, `typescript`(patch), `helmet` 등 minor/patch 업데이트.
- **FR-003**: `@modelcontextprotocol/sdk` — 이미 ^1.29이면 lockfile 정합성만 확인.
- **FR-004**: major 업그레이드(`eslint` 10, `vitest` 4, `zod` 4 등)는 제외.

## Out of Scope

- eslint 8→10, vitest 3→4, zod 3→4 major 마이그레이션

## Success Criteria *(mandatory)*

- **SC-001**: `npm audit` 0건
- **SC-002**: `npm run lint && npm run type-check && npm test` 통과
- **SC-003**: `npm run rebuild-native` 검증 (better-sqlite3)
