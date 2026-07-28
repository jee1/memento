# Feature Specification: 메인 Dockerfile Node 24

**Feature Branch**: `issue-702-dockerfile-node24`  
**Created**: 2026-07-27  
**Status**: Active  
**Input**: GitHub Issue #702 — chore(docker): 메인 Dockerfile을 node:24로 올림  
**Parent**: #700

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 컨테이너 런타임이 engines.node와 일치 (Priority: P1)

운영/로컬 Docker 이미지가 Node 24에서 빌드·실행된다.

**Independent Test**: `docker build` 성공 후 컨테이너에서 `node -v`가 24.x, 헬스체크 또는 기동 스모크

**Acceptance Scenarios**:

1. **Given** 메인 Dockerfile, **When** 검사, **Then** `node:20` 잔존 없음.
2. **Given** `docker build`, **When** 완료, **Then** exit 0.
3. **Given** 실행 중 컨테이너, **When** `node -v`, **Then** v24.x.

## Requirements *(mandatory)*

- **FR-001**: builder `node:24-alpine`, production `node:24-slim`으로 변경.
- **FR-002**: alpine/slim 조합 유지; native 모듈이 Node 24 ABI로 설치되는지 빌드로 확인.
- **FR-003**: 배포 문서에 베이스 이미지가 Node 24임을 필요 시 한 줄 정합.
- **FR-004**: 배포 전 `npm run db:pre-docker-deploy` 런북은 기존 문서 유지·확인.

## Out of Scope

- `.nvmrc` (#701), `@types/node` (#703)
- vitest 4 / eslint 10 major

## Success Criteria *(mandatory)*

- **SC-001**: Dockerfile에 `node:20` 없음
- **SC-002**: `docker build` 성공
- **SC-003**: 컨테이너 `node -v`가 24.x
- **SC-004**: MCP/HTTP 기동 스모크 또는 `/health` 통과
