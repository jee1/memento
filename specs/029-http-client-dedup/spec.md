# Feature Specification: HTTP 클라이언트 중복 제거

**Feature Branch**: `029-http-client-dedup`  
**Created**: 2026-06-28  
**Status**: Draft  
**Input**: GitHub Issue #584 — axios / node-fetch HTTP 클라이언트 중복 제거 (부모 #580)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 루트 의존성 단일화 (Priority: P1)

유지보수자가 루트 `package.json`을 볼 때 HTTP 클라이언트 라이브러리가 중복 선언되어 있지 않아야 한다. Node.js 24+ native `fetch`로 스크립트·테스트 HTTP 호출을 처리한다.

**Why this priority**: `analyze_dependencies.py` MEDIUM 이슈의 직접 원인이며 번들·lockfile 중복을 줄인다.

**Independent Test**: 루트 `package.json`에 `axios`/`node-fetch` 없음 + `npm run build && npm test` 통과.

**Acceptance Scenarios**:

1. **Given** 루트 `package.json`, **When** dependencies 검사, **Then** `axios`와 `node-fetch`가 모두 없다.
2. **Given** `scripts/mcp-http-client.js`, **When** HTTP 호출, **Then** native `fetch`로 동작한다.
3. **Given** `scripts/test-docker.js`, **When** health/remember/recall 호출, **Then** native `fetch`로 동작한다.

### User Story 2 — workspace @memento/core pin 정책 문서화 (Priority: P2)

개발자가 workspace 내부 `@memento/core` 버전 pin(`1.17.0` vs `*`) 차이와 선택 이유를 문서에서 확인할 수 있어야 한다.

**Why this priority**: LOW 우선순위이지만 후속 deps 작업(#580)의 기준선이 된다.

**Independent Test**: `docs/agents/architecture.md`에 pin 정책 섹션 존재.

**Acceptance Scenarios**:

1. **Given** architecture 문서, **When** `@memento/core` pin 검색, **Then** 루트 exact pin vs workspace `*` 사용 맥락이 설명된다.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 루트 `package.json` dependencies에서 `axios`와 `node-fetch`를 제거한다.
- **FR-002**: 루트 스크립트·core 테스트의 `node-fetch`/`axios` import를 native `fetch`로 교체한다.
- **FR-003**: `@memento/client`·`mcp-client` 패키지의 `axios`는 공개 HTTP 클라이언트 API로 유지한다 (본 이슈 범위 외).
- **FR-004**: `@memento/core` workspace pin 정책을 `docs/agents/architecture.md`에 문서화한다.

## Out of Scope

- `memento-client` / `mcp-client` axios → fetch 마이그레이션
- transitive dependency(`gaxios` 등) 제거

## Success Criteria *(mandatory)*

- **SC-001**: Issue #584 완료 기준 3항목 충족
- **SC-002**: `npm run build && npm test && npm run lint && npm run type-check` 통과
- **SC-003**: HTTP 호출 경로 회귀 없음 (기존 테스트 green)
