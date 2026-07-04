# Feature Specification: graph.js + embedding-map-chart.js 복잡도 분해

**Feature Branch**: `issue-629-static-graph-refactor`  
**Created**: 2026-07-04  
**Status**: Draft  
**Input**: GitHub Issue #633 — refactor(static): graph.js + embedding-map-chart.js 복잡도 분해 (부모 #629)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Graph 뷰 동작 유지 (Priority: P1)

운영자가 `/graph` 또는 대시보드 Graph iframe에서 필터·검색·노드 클릭·줌/팬·리사이즈가 기존과 동일하게 동작해야 한다.

**Independent Test**: `tests/static-design-contracts.spec.ts` + 수동 스모크.

**Acceptance Scenarios**:

1. **Given** Graph 페이지 로드, **When** 타입/importance 필터 적용, **Then** `/admin/graph` API 호출 후 D3 렌더.
2. **Given** 렌더된 그래프, **When** 검색어 입력, **Then** 매칭 노드 하이라이트·딤 처리 유지.
3. **Given** 노드 클릭, **When** 상세 패널 표시, **Then** CSS 토큰 기반 색상·escHtml 유지.

### User Story 2 — Embedding Map 차트 동작 유지 (Priority: P1)

대시보드 Embedding Map 탭에서 scatter 렌더·줌·툴팁·사이드 패널이 기존과 동일해야 한다.

**Independent Test**: dashboard contract specs + `npm test`.

**Acceptance Scenarios**:

1. **Given** Embedding Map 탭 활성화, **When** 데이터 로드, **Then** `st.renderScatter` 호출로 차트 표시.
2. **Given** scatter 점 클릭, **When** 사이드 패널 열림, **Then** 기존 `st.openSidePanel` 동작 유지.

### User Story 3 — God function 분해 (Priority: P1)

`renderGraph`, `renderScatter`, `loadEmbeddingMap` 등 복잡 함수를 50줄·복잡도 10 이하로 분해한다.

**Independent Test**: `wc -l` + slop-detector/`npm run lint:js`.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `graph.js`를 `graph-shared.js`, `graph-search.js`, `graph-detail.js`, `graph-render.js`, `graph-fetch.js`, `graph.js`로 분해.
- **FR-002**: `embedding-map-chart.js`를 colors/setup/scatter 서브모듈로 분해.
- **FR-003**: `embedding-map-fetch.js`의 status/helper를 `embedding-map-fetch-status.js`로 분리.
- **FR-004**: `static/graph.html`, `static/dashboard.html` script 로드 순서 갱신.
- **FR-005**: 동작·public surface 변경 없음 (`__MEMENTO_GRAPH__` 내부, `st.setupChart`/`st.renderScatter`/`st.loadEmbeddingMap` 유지).

## Out of Scope

- CSS/디자인 토큰 변경
- API·스키마 변경
- graph resize 최적화 (별도 이슈)

## Success Criteria *(mandatory)*

- **SC-001**: Issue #633 완료 기준 3항목 충족
- **SC-002**: `npm test`, `npm run lint`, `npm run type-check` 통과
- **SC-003**: 단일 함수 ≤50줄·복잡도 목표 달성 (renderGraph 등 god function 해소)
