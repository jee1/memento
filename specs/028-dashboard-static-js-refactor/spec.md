# Feature Specification: 대시보드 static JS God function 분해

**Feature Branch**: `028-dashboard-static-js-refactor`  
**Created**: 2026-06-20  
**Status**: Draft  
**Input**: GitHub Issue #546 — slop-detector triage, 대시보드 static JS God function·cyclomatic complexity

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 대시보드 탭·패널 동작 유지 (Priority: P1)

운영자가 Anchor / Embedding Map / Graph / Review / Agent Sessions 탭을 전환할 때 기존과 동일하게 패널이 활성화되고 각 패널 init/refresh가 호출되어야 한다.

**Why this priority**: `dashboard-tabs.js`는 모든 탭의 진입점이며 회귀 시 전체 대시보드가 깨진다.

**Independent Test**: `dashboard-tabs.js` contract spec + static design contract + 수동 탭 전환 스모크.

**Acceptance Scenarios**:

1. **Given** 대시보드 로드, **When** 각 탭 클릭, **Then** 해당 패널만 `active`/`aria-hidden`이 갱신된다.
2. **Given** Graph 탭, **When** 최초 활성화, **Then** iframe이 `GRAPH_IFRAME_SRC`로 지연 로드된다.
3. **Given** 키보드 탐색, **When** Arrow/Home/End/Enter, **Then** roving tabindex 및 manual activation이 유지된다.

### User Story 2 — 패널 렌더·fetch 모듈 분리 (Priority: P1)

God function으로 표시된 5개 JS 파일을 render / fetch / wire / state 단위로 분리하되 DOM·API 동작은 변경하지 않는다.

**Why this priority**: slop-detector SUSPICIOUS~INFLATED 구간 해소 및 UI 변경 시 회귀 위험 감소.

**Independent Test**: `npm test`, `tests/static-design-contracts.spec.ts`, dashboard panel contract specs.

**Acceptance Scenarios**:

1. **Given** 리팩터 후, **When** slop-detector scan, **Then** 5개 대상 파일 God function 경고가 유의미하게 감소한다.
2. **Given** Agent Sessions / Review / Embedding Map, **When** 데이터 로드·렌더, **Then** 기존과 동일한 DOM 구조·API 호출이 유지된다.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `dashboard-tabs.js`, `agent-sessions-panel-render.js`, `embedding-map.js`, `review-candidates-panel-render.js`, `review-candidates-panel-health.js`의 동작은 변경하지 않는다.
- **FR-002**: IIFE 최상위 anonymous 함수 및 50줄 초과 named function을 기능 단위 파일/함수로 분해한다.
- **FR-003**: nesting depth 6+ 구간은 early return·named function으로 완화한다.
- **FR-004**: `static/dashboard.html` script 로드 순서는 의존성( shared → render → main )을 유지한다.
- **FR-005**: 기존 dashboard contract spec이 참조하는 public API(`initEmbeddingMap`, `initAgentSessionsPanel`, `__MEMENTO_DASHBOARD_TABS__` 등)는 유지한다.

## Out of Scope

- CSS/디자인 토큰 변경
- API·스키마 변경
- spec 디렉터리 God function (#166)

## Success Criteria *(mandatory)*

- **SC-001**: Issue #546 완료 기준 3항목 충족
- **SC-002**: `npm test`, `npm run lint`, `npm run type-check` 통과
- **SC-003**: slop-detector God function 점수/경고 개선 (5개 대상 파일)
