# Tasks: 기억 관계 그래프 뷰

**Input**: Design documents from `/specs/009-memory-graph-view/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Constitution I(Test-First Delivery)에 따라 테스트 태스크 포함 — 테스트 먼저 실패하게 작성 후 구현.

**Organization**: 4개 사용자 스토리 기준으로 단계 구성. P1(그래프 렌더링) → P2(노드 인터랙션) → P3(필터링) → P4(레이아웃).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 의존 관계 없음)
- **[Story]**: 대응되는 사용자 스토리 (US1~US4)

---

## Phase 1: Setup

**Purpose**: 기존 프로젝트 구조 확인 및 신규 파일 위치 준비

- [x] T001 `static/` 디렉터리 존재 확인, `static/graph.html` 파일 생성 (빈 파일)
- [x] T002 `packages/memento-server/src/server/routes/admin.routes.ts`에서 기존 relations 라우트 패턴 숙지 (읽기 전용)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 사용자 스토리에 필요한 핵심 인프라 — 이 단계 완료 전 US 작업 불가

**⚠️ CRITICAL**: 테스트를 먼저 작성하고 실패를 확인한 후 구현 진행

- [x] T003 `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 `GET /admin/graph` 테스트 블록 추가 (실패하는 테스트): 200 응답, nodes/edges/meta 구조 검증
- [x] T004 [P] `packages/memento-core/src/domains/relation/services/relation-graph.ts`에서 `getRelations` 메서드 시그니처 및 반환 타입 파악 (읽기 전용)
- [x] T005 [P] `packages/memento-core/src/domains/memory/repositories/kg-triple-repository.ts`에서 KgTripleRow 타입 및 쿼리 패턴 파악 (읽기 전용)

**Checkpoint**: T003 테스트가 실패함을 확인 후 Phase 3로 진행

---

## Phase 3: User Story 1 - 기억 관계 그래프 조회 (Priority: P1) 🎯 MVP

**Goal**: `/admin/graph` API 엔드포인트 + `static/graph.html` force-directed 그래프 렌더링

**Independent Test**: `npm run dev:http` 실행 후 `GET /admin/graph` 응답에 nodes/edges가 포함되는지 확인, `http://localhost:3000/graph` 접속 시 그래프가 렌더링되는지 확인

### Tests for User Story 1

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [P] [US1] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: DB에 memory_item/memory_relation이 있을 때 노드와 엣지가 반환되는지 검증
- [x] T007 [P] [US1] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: DB가 비어있을 때 빈 nodes[]/edges[] 반환 검증
- [x] T008 [P] [US1] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: 응답 포맷 검증 (GraphNode 필드: id, label, type, importance, created_at, tags, pinned)

### Implementation for User Story 1

- [x] T009 [US1] `packages/memento-server/src/server/routes/admin.routes.ts`에 GraphNode, GraphEdge, GraphResponse, GraphFilter 인터페이스 타입 정의 추가
- [x] T010 [US1] `packages/memento-server/src/server/routes/admin.routes.ts`에 `buildGraphResponse(db, filters)` 순수 함수 구현: memory_item 조회 → GraphNode[] (label=content 앞 50자, content=전체), memory_relation 조회 → GraphEdge[], meta 생성
- [x] T011 [US1] `packages/memento-server/src/server/routes/admin.routes.ts`에 `router.get('/graph', ...)` 라우트 구현: 쿼리 파라미터 파싱, buildGraphResponse 호출, JSON 반환
- [x] T012 [US1] `packages/memento-server/src/server/http-server.ts`에 `app.get('/graph', ...)` 라우트 추가: `static/graph.html` sendFile 반환
- [x] T013 [US1] `static/graph.html` 구현: D3.js v7 CDN 로드, `/admin/graph` API 호출, SVG force-directed 그래프 렌더링 (노드: 타입별 색상, 크기: importance 비례)
- [x] T014 [US1] `static/graph.html`에 엣지 렌더링 추가: relation_type별 색상 구분, confidence에 따른 선 굵기
- [x] T015 [US1] `static/graph.html`에 빈 상태 처리 추가: nodes가 비어있을 때 "기억 데이터 없음" 메시지 표시
- [x] T016 [US1] `npm run type-check` 통과 확인 및 T006~T008 테스트 통과 확인

**Checkpoint**: `GET /admin/graph` 반환값에 nodes/edges가 있고, `/graph` 페이지에 그래프가 렌더링됨

---

## Phase 4: User Story 2 - 노드 인터랙션 및 기억 상세 조회 (Priority: P2)

**Goal**: 노드 마우스오버 시 툴팁, 클릭 시 상세 정보 패널 표시

**Independent Test**: `/graph` 에서 노드에 마우스를 올리면 툴팁이 나타나고, 클릭 시 사이드 패널에 기억 상세 정보가 표시됨

### Tests for User Story 2

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T017 [P] [US2] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: GraphNode 응답에 `content`(전체 텍스트), `label`(50자 truncate), `tags`, `created_at`, `pinned` 필드가 모두 포함되는지 검증

### Implementation for User Story 2

- [x] T018 [US2] `static/graph.html`에 툴팁 요소 추가: 노드 mouseover 이벤트 → div 툴팁에 label(50자) 표시, mouseout 이벤트 → 툴팁 숨김
- [x] T019 [US2] `static/graph.html`에 상세 정보 사이드 패널 추가: 노드 click 이벤트 → 패널에 node.content(전체), node.type, node.importance, node.created_at, node.tags, node.pinned 표시 (node.content는 API GraphNode.content 필드 사용)
- [x] T020 [US2] `static/graph.html`에 패널 닫기 처리 추가: 빈 SVG 영역 클릭 시 패널 닫힘

**Checkpoint**: 노드 클릭 → 패널 열림, 빈 영역 클릭 → 패널 닫힘이 동작함

---

## Phase 5: User Story 3 - 그래프 필터링 (Priority: P3)

**Goal**: 기억 타입/중요도 임계값 필터 UI, 필터 적용 시 그래프 재로드

**Independent Test**: 필터 UI에서 타입 체크박스를 선택하거나 중요도 슬라이더를 조정하면 `/admin/graph?types=...&min_importance=...` 재요청 후 그래프가 업데이트됨

### Tests for User Story 3

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T021 [P] [US3] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: `?types=episodic` 파라미터 적용 시 episodic 타입 노드만 반환 검증
- [x] T022 [P] [US3] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: `?min_importance=0.8` 적용 시 importance < 0.8 노드 제외 검증
- [x] T023 [P] [US3] `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 테스트 추가: `?limit=2` 적용 시 노드 2개 이하 반환 및 `meta.truncated=true` 검증

### Implementation for User Story 3

- [x] T024 [US3] `packages/memento-server/src/server/routes/admin.routes.ts`의 `buildGraphResponse` 함수에 `types` 필터 로직 구현 (memory_item.type IN (...))
- [x] T025 [US3] `packages/memento-server/src/server/routes/admin.routes.ts`의 `buildGraphResponse`에 `min_importance` 필터 및 `limit` 적용 로직 구현 (importance DESC 정렬 후 LIMIT)
- [x] T026 [US3] `packages/memento-server/src/server/routes/admin.routes.ts`의 `router.get('/graph')`에 쿼리 파라미터 검증 추가: `min_importance` 범위(0~1), `limit` 범위(1~1000)
- [x] T027 [US3] `static/graph.html`에 필터 UI 추가: 타입 체크박스(episodic/semantic/procedural/working), 중요도 슬라이더(0~1), "필터 적용" 버튼
- [x] T028 [US3] `static/graph.html`에 필터 적용 시 API 재호출 로직 구현, 그래프 재렌더링
- [x] T029 [US3] `static/graph.html`에 "필터 초기화" 버튼 추가: 전체 기억 다시 로드
- [x] T030 [US3] `packages/memento-server/src/server/routes/admin.routes.spec.ts` T021~T023 테스트 통과 확인

**Checkpoint**: 필터 적용 → 그래프가 필터 조건에 맞는 노드만 표시, 초기화 → 전체 표시

---

## Phase 6: User Story 4 - 레이아웃 상호작용 (Priority: P4)

**Goal**: 노드 드래그, 줌인/줌아웃 레이아웃 조작

**Independent Test**: 노드를 드래그하면 위치가 이동하고 엣지가 따라 이동함, 마우스 휠로 줌 동작함

### Implementation for User Story 4

- [x] T031 [US4] `static/graph.html`의 D3 force simulation에 drag 핸들러 추가 (`d3.drag()`)
- [x] T032 [US4] `static/graph.html`에 D3 zoom 동작 추가 (`d3.zoom()`): 마우스 휠 줌, 드래그로 팬

**Checkpoint**: 노드 드래그 동작, 마우스 휠 줌 동작

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 품질 게이트, 엣지 케이스 처리, 최종 검증

- [x] T033 `packages/memento-server/src/server/routes/admin.routes.spec.ts`에 엣지 케이스 테스트 추가: 500개 초과 노드 시 meta.truncated=true 검증
- [x] T034 `static/graph.html`에 로딩 상태 표시 추가: API 호출 중 스피너/메시지 표시
- [x] T035 `static/graph.html`에 API 오류 처리 추가: fetch 실패 시 오류 메시지 표시
- [x] T036 [P] `static/graph.html`에 긴 content truncate 처리 확인: label 50자 제한, 패널 내 스크롤
- [x] T037 `npm run lint` 통과 확인 및 린트 오류 수정
- [x] T038 `npm run type-check` 통과 확인 및 타입 오류 수정
- [x] T039 `npm test` 전체 통과 확인
- [x] T040 [P] `quickstart.md` 지침에 따라 로컬에서 `/graph` UI 수동 검증

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 즉시 시작 가능
- **Foundational (Phase 2)**: Phase 1 완료 후 — 모든 US 작업 블로킹
- **US1 (Phase 3)**: Phase 2 완료 후 시작 — MVP 핵심
- **US2 (Phase 4)**: Phase 3 완료 후 시작 (UI 의존)
- **US3 (Phase 5)**: Phase 3 완료 후 시작 (API 의존)
- **US4 (Phase 6)**: Phase 3 완료 후 시작 (D3 의존)
- **Polish (Phase 7)**: 원하는 US 완료 후

### User Story Dependencies

- **US1 (P1)**: Phase 2 완료 후 바로 시작 — 다른 US 의존 없음
- **US2 (P2)**: US1 완료 후 시작 (graph.html D3 코드 의존)
- **US3 (P3)**: US1 완료 후 시작 (admin.routes.ts API 의존), US2와 병렬 가능
- **US4 (P4)**: US1 완료 후 시작 (D3 force simulation 의존), US2/US3와 병렬 가능

### Parallel Opportunities

- T004, T005는 T003과 병렬 가능
- T006, T007, T008은 병렬 작성 가능 (모두 같은 테스트 파일의 다른 it 블록)
- T009, T010, T011, T012, T013은 순차 필요 (의존 관계)
- US2, US3, US4 (Phase 4, 5, 6)는 Phase 3 완료 후 병렬 진행 가능

---

## Parallel Example: User Story 1

```bash
# 먼저 테스트 작성 (병렬로):
T006: 노드/엣지 반환 테스트
T007: 빈 DB 테스트
T008: 응답 포맷 테스트

# 테스트 실패 확인 후 구현 (순차):
T009 → T010 → T011 (admin.routes.ts 변경)
T012 (http-server.ts 변경, T011과 병렬 가능)
T013 → T014 → T015 (static/graph.html 구현)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup 완료 (T001~T002)
2. Phase 2: Foundational (T003~T005) — 테스트 먼저 실패 확인
3. Phase 3: US1 (T006~T016) — API + 기본 그래프 렌더링
4. **STOP and VALIDATE**: `curl /admin/graph` 응답 확인, `/graph` 브라우저 접속 확인
5. 검증 통과 시 Phase 4~6 선택적 진행

### Incremental Delivery

1. Phase 1+2 → Foundation ready
2. Phase 3 (US1) → API + 그래프 렌더링 **MVP 완성**
3. Phase 4 (US2) → 노드 클릭 상세 정보 추가
4. Phase 5 (US3) → 필터링 기능 추가
5. Phase 6 (US4) → 드래그/줌 추가
6. Phase 7 → 품질 게이트 최종 통과

---

## Notes

- [P] 태스크는 다른 파일 또는 독립적 테스트 블록 — 병렬 실행 가능
- [Story] 레이블은 spec.md 사용자 스토리와 1:1 대응
- Constitution I: 테스트 먼저 작성 → 실패 확인 → 구현 순서 준수
- Constitution II: 기존 MCP 도구/API 계약 변경 없음 (신규 엔드포인트만 추가)
- Constitution III: DB 스키마 변경 없음 (읽기 전용)
- 각 Phase 완료 후 체크포인트에서 독립 검증
