# Feature Specification: @types/node@24 및 native 검증 체크리스트

**Feature Branch**: `issue-703-types-node24`
**Created**: 2026-07-27
**Status**: Active
**Input**: GitHub Issue #703 — chore(deps): @types/node@24 정렬 및 Node 24 native 검증 체크리스트
**Parent**: #700

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 타입 정의가 런타임 Node 24와 정합 (Priority: P1)

`@types/node` major가 24로 맞춰지고 type-check가 통과한다.

**Independent Test**: `npm run type-check`

### User Story 2 — 전환 후 rebuild 누락 방지 (Priority: P2)

운영자가 Node 24 전환 시 native 검증 순서를 문서로 따른다.

**Independent Test**: 문서에 npm ci → rebuild-native → smoke → type-check 순서 존재

## Requirements *(mandatory)*

- **FR-001**: root 및 워크스페이스 `@types/node` → `^24`
- **FR-002**: `npm run type-check` green
- **FR-003**: ops 문서에 Node 24 전환 검증 체크리스트 명시

## Out of Scope

- vitest 4 / eslint 10 (#691)
- Dockerfile (#702), `.nvmrc` (#701)

## Success Criteria *(mandatory)*

- **SC-001**: `@types/node` major 24
- **SC-002**: type-check green
- **SC-003**: 검증 체크리스트 문서화
