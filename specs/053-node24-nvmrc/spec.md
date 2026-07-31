# Feature Specification: Node 24용 .nvmrc 및 로컬 가이드

**Feature Branch**: `issue-701-node24-nvmrc`
**Created**: 2026-07-27
**Status**: Active
**Input**: GitHub Issue #701 — chore(tooling): Node 24용 .nvmrc 추가 및 로컬 가이드 보강
**Parent**: #700

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 디렉터리 진입 시 Node 24 자동 전환 (Priority: P1)

개발자가 nvm을 쓰는 환경에서 저장소에 들어오면 Node 24를 쓰도록 안내된다.

**Independent Test**: `cat .nvmrc` → `24`; `nvm use` 후 `node -v`가 24.x

**Acceptance Scenarios**:

1. **Given** 루트 `.nvmrc`, **When** `nvm use`, **Then** Node 24.x가 선택된다.
2. **Given** 로컬 가이드, **When** Cursor agent PATH가 nvm보다 앞선 경우, **Then** 문서가 `which node` 오판 위험을 명시한다.
3. **Given** Node major 전환, **When** 가이드를 따른다, **Then** `npm run rebuild-native` 단계가 포함된다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 루트 `.nvmrc`에 `24` (또는 pin된 24.x)를 추가한다.
- **FR-002**: `docs/operations/*/troubleshooting-node-version.md` 및/또는 AGENTS.md gotcha에 로컬 검증 단락을 보강한다.
- **FR-003**: 단락에 `nvm use`/default 확인, Cursor agent PATH 주의, `rebuild-native`를 포함한다.

## Out of Scope

- Dockerfile 변경 (#702)
- `@types/node` bump (#703)

## Success Criteria *(mandatory)*

- **SC-001**: `.nvmrc`가 커밋되어 있다.
- **SC-002**: 문서에 로컬 검증 한 단락이 있다.
- **SC-003**: `node -v`가 24.x인 셸에서 안내와 일치한다.
