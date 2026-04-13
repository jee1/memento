# Tasks: Embedding Map Dashboard

**Input**: Design documents from `specs/014-embedding-map-dashboard/`  
**Branch**: `014-embedding-map-dashboard`  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Generated**: 2026-04-13

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 의존성 없음)
- **[Story]**: 해당 User Story (US1~US4)
- 파일 경로 명시 필수

---

## Phase 1: Setup

**Purpose**: `umap-js` 의존성 추가 및 프로젝트 준비

- [X] T001 `packages/memento-server/package.json`의 `dependencies`에 `"umap-js": "^1.3.3"` 추가 후 `npm install` 실행

---

## Phase 2: Foundational — 서버 API (Blocking)

**Purpose**: 모든 User Story의 프론트엔드 구현 전 `GET /admin/embedding-map` API가 완성되어야 한다.

**⚠️ CRITICAL**: Phase 2가 완료되기 전까지 Phase 3+ 작업 착수 불가

- [X] T002 `packages/memento-server/src/server/routes/admin/admin-embedding-map-response.spec.ts` 생성 — 단위 테스트 먼저 작성 (TDD): K-Means 클러스터 수·범위 검증(출력 길이=입력 수, 클러스터 번호 0~k-1 범위 확인; K-Means는 비결정적이므로 특정 번호 단언 금지), k>n 자동 조정(effectiveK===n), 캐시 히트/만료, NO_EMBEDDINGS 에러(provider 포함; count===0일 때 INSUFFICIENT_DATA 아님), INSUFFICIENT_DATA 에러(count 포함; 0<count<10), 라우트 파라미터 검증: 잘못된 provider→400, limit=0→400, k=1→400
- [X] T003 `packages/memento-server/src/server/routes/admin/admin-embedding-map-response.ts` 생성 — 타입 정의(`EmbeddingPoint`, `EmbeddingMapResponse`, `EmbeddingMapParams`), 인메모리 캐시(Map, TTL 5분), Lloyd's K-Means 구현(max 100 iter), `buildEmbeddingMapResponse()` 함수: DB JOIN 쿼리→UMAP fit→K-Means→EmbeddingPoint[] 조합
- [X] T004 `packages/memento-server/src/server/routes/admin/admin-embedding-map.routes.ts` 생성 — `registerAdminEmbeddingMapRoute(router, db)`: 쿼리 파라미터 검증(provider/limit/k), 에러 코드→HTTP 상태 매핑(INSUFFICIENT_DATA→400, NO_EMBEDDINGS→400, 기타→500), `buildEmbeddingMapResponse` 호출
- [X] T005 `packages/memento-server/src/server/routes/admin.routes.ts` 수정 — `registerAdminEmbeddingMapRoute` import 추가, `registerAdminGraphRoute` 호출 바로 아래에 `registerAdminEmbeddingMapRoute(router, db)` 등록

**Checkpoint**: `GET /admin/embedding-map?provider=minilm&limit=300&k=6` 요청 시 JSON 응답 확인 후 Phase 3 착수

---

## Phase 3: User Story 1 — 임베딩 맵 조회 (Priority: P1) 🎯 MVP

**Goal**: 임베딩 맵 탭 클릭 시 기본 파라미터로 자동 로드, scatter plot 렌더링

**Independent Test**: 대시보드에서 "Embedding Map" 탭 클릭 → 로딩 스피너 → 기억들이 점으로 표시된 2D 산점도 렌더링 확인

- [X] T006 [US1] `static/dashboard.html` 수정 — 기존 Anchor Map 콘텐츠를 `<div id="tab-anchor-map" class="tab-panel">` 로 감싸기; `<div class="tab-bar">` + 탭 버튼 2개(Anchor Map / Embedding Map) 추가; Embedding Map 탭 패널(`id="tab-embedding-map"`) 추가(컨트롤 바: provider select·limit·k·Load 버튼·캐시 표시, SVG 컨테이너 `id="em-scatter"`, 로딩 div `id="em-loading"`, 에러 div `id="em-error"`, 사이드 패널 div `id="em-side-panel"`); 탭 전환 인라인 스크립트; `<script src="/static/js/embedding-map.js"></script>` 추가
- [X] T007 [US1] `static/js/embedding-map.js` 생성 — 탭 초기화(`initEmbeddingMap`, 최초 1회 자동 로드 플래그), `loadEmbeddingMap(params)` 비동기 함수(Admin API Bearer 인증, fetch 실패 시 재시도 버튼 표시 FR-012), 로딩 스피너/"UMAP 계산 중..." 메시지(US1 AC2), 기억 10개 미만 에러 메시지(US1 AC3), provider 임베딩 없음 에러 메시지(US1 AC4), D3.js v7 기본 scatter plot 렌더링(SVG, 점 배치, x/y 스케일)

---

## Phase 4: User Story 2 — 클러스터 탐색 (Priority: P2)

**Goal**: 클러스터별 색상 구분, 마우스 호버 툴팁

**Independent Test**: 산점도에서 서로 다른 색상의 점 그룹 확인; 점 위 마우스 오버 시 content 앞 80자 + type 툴팁 표시

- [X] T008 [US2] `static/js/embedding-map.js` 수정 — 클러스터별 색상 적용: `d3.schemeTableau10` 팔레트(k≤10), k>10 시 `d3.schemeSet3` 보완; 점 반지름 `r = 4 + importance * 6` (importance 비례 크기, FR-007)
- [X] T009 [US2] `static/js/embedding-map.js` 수정 — 마우스 호버 툴팁 구현: `mouseover` 이벤트 → content 앞 80자 + type 표시(FR-008), `mouseleave` 이벤트 → 툴팁 숨김; 툴팁 div 생성 및 포지셔닝

---

## Phase 5: User Story 3 — 기억 상세 조회 (Priority: P3)

**Goal**: 점 클릭 시 사이드 패널 열기, 전체 내용·태그·중요도·생성일 표시

**Independent Test**: 임의 점 클릭 → 오른쪽 사이드 패널 슬라이드인 → 기억 전체 내용 확인; X 버튼 / 빈 공간 클릭 / Escape 키 → 패널 닫힘 확인

- [X] T010 [US3] `static/js/embedding-map.js` 수정 — 점 `click` 이벤트 → `openSidePanel(point)`: 사이드 패널에 content 전체·tags·importance·created_at 렌더링(FR-009); `closeSidePanel()`: SVG 배경 클릭, 패널 내 X 버튼(`#em-panel-close`) 클릭, `keydown` Escape 키 → 패널 닫기; 다른 점 클릭 시 패널 내용 업데이트(US3 AC3)

---

## Phase 6: User Story 4 — 줌/패닝 & 파라미터 조정 (Priority: P4)

**Goal**: 마우스 휠 줌/드래그 패닝, provider·limit·k 파라미터 변경 후 재로드, 캐시 표시

**Independent Test**: 마우스 휠 줌·드래그 패닝 동작 확인; provider 변경 후 Load 클릭 → 재계산; 캐시 히트 시 "N분 전 캐시" 표시 확인

- [X] T011 [US4] `static/js/embedding-map.js` 수정 — SVG에 `d3.zoom()` 적용: `scaleExtent([0.3, 10])`, 마우스 휠 줌 + 드래그 패닝(FR-010); zoom transform을 scatter plot g 요소에 적용
- [X] T012 [US4] `static/dashboard.html` + `static/js/embedding-map.js` 수정 — Load 버튼(`#em-load-btn`) 클릭 이벤트: `#em-provider` / `#em-limit` / `#em-k` 값 읽어 `loadEmbeddingMap(params)` 호출(US4 Note: 파라미터 변경 후 수동 재로드); 응답 `meta.cached === true` 시 `#em-cache-info`에 "N분 전 캐시" 표시(FR-011): `Math.round((Date.now() - new Date(meta.computed_at)) / 60000)`

---

## Final Phase: Polish & Quality Gates

**Purpose**: Constitution IV 품질 게이트 통과 확인

- [X] T013 [P] 신규·수정 서버 TS 파일 ESLint 통과: `admin-embedding-map-response.ts`, `admin-embedding-map.routes.ts`, `admin.routes.ts` (`npx eslint …`); 워크스페이스 전체 `memento-server/src/**/*.ts` 일괄 린트는 기존 파일에 별도 이슈 존재
- [X] T014 [P] `packages/memento-server` 에서 `npm run type-check` 실행 후 타입 오류 수정
- [X] T015 신규 단위 테스트(`admin-embedding-map-response.spec.ts`) 포함 `npm test` 실행 후 전체 통과 확인
- [ ] T016 수동 성능·정확도 검증: `GET /admin/embedding-map?provider=minilm&limit=300&k=6` 첫 응답 ≤30초(SC-001) 확인; 동일 요청 재시도 시 ≤1초 캐시 반환(SC-002) 확인; 샘플 기억 10개 이상으로 유사 주제 기억이 같은 클러스터로 그룹화되는지 육안 검증(SC-003)

---

## Dependencies (User Story 완료 순서)

```
T001 (Setup)
  └─ T002–T005 (API, Foundational)
       ├─ T006–T007 (US1) ← MVP 완료 기준
       │    └─ T008–T009 (US2)
       │         └─ T010 (US3)
       │              └─ T011–T012 (US4)
       │                   └─ T013–T016 (Polish)
       └─ (T006–T012는 T001~T005 완료 후 순차 진행)
```

**병렬 실행 가능**:
- T013, T014 — lint·type-check는 동시 실행 가능
- T016 — T015 완료 후 서버 실행 중 수행 (독립적 수동 검증)
- US1~US4 내 프론트엔드 작업은 각 Story가 이전 Story 완료 후 착수 가능

---

## Implementation Strategy

**MVP (Phase 1~3, T001–T007)**:
- API 엔드포인트 + 기본 scatter plot 렌더링
- "임베딩 맵 탭 클릭 → 점 표시" 최소 동작 확인
- 이 시점에서 SC-001(30초 이내 렌더링), SC-004(3번 인터랙션) 검증 가능

**Increment 2 (Phase 4, T008–T009)**: 클러스터 색상 + 툴팁  
**Increment 3 (Phase 5, T010)**: 사이드 패널  
**Increment 4 (Phase 6, T011–T012)**: 줌/패닝 + 파라미터 조정

---

## 총 작업 요약

| Phase | 태스크 수 | 비고 |
|-------|----------|------|
| Setup | 1 | T001 |
| Foundational | 4 | T002–T005 (서버 API) |
| US1 (P1) MVP | 2 | T006–T007 |
| US2 (P2) | 2 | T008–T009 |
| US3 (P3) | 1 | T010 |
| US4 (P4) | 2 | T011–T012 |
| Polish | 4 | T013–T016 |
| **합계** | **16** | |
