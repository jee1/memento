# Tasks: 대시보드 앵커 맵 검색 안정화

**Input**: `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/` (plan.md, spec.md, research.md, data-model.md, contracts/)  
**Prerequisites**: plan.md, spec.md 완료됨.

**Tests**: 헌장 I에 따라 **T000**에서 실패하는 자동화 테스트(Red)를 먼저 추가한 뒤 T001–T004로 수정한다(Green). 브라우저 **수동 회귀(quickstart.md)** 는 US1/US2 검증에 포함한다.

## Format

`[ID] [P?] [Story] Description` — Story: `US1`(P1), `US2`(P2), `POLISH`

---

## Phase 1: User Story 1 — 빈 맵·미로딩에서 검색 시 세션 유지 (Priority: P1)

**Goal**: `nodes` 미초기화로 인한 `TypeError` 제거(FR-001, FR-002, FR-005, SC-001, SC-003).

**Independent Test**: T000(`npm test`에 포함) + `quickstart.md` 필수 시나리오.

### Implementation

- [X] T000 [US1] 헌장 I(Red 단계): Vitest로 `nodes` 미초기화 또는 빈 맵에 상응하는 조건에서 검색 결과 강조 로직이 **TypeError 없이** 끝남을 단언하는 테스트를 추가한다. **픽스 적용 전에는 이 단언이 실패**해야 하고, T001–T004 적용 후 `npm test`에서 통과해야 한다. 위치는 `tests/` 또는 `packages/memento-server/src/server/` 등 기존 Vitest 관례에 따르며, 필요 시 재현 조건 최소 복제 또는 소량의 순수 헬퍼 분리를 허용한다.
- [X] T001 [US1] `/home/jee1lee/git/memento/static/js/anchor-map.js` 상단 전역에서 `nodes`·`links`를 빈 배열(`[]`)로 초기화하여 `undefined.find` 불변식을 제거한다.
- [X] T002 [US1] 동일 파일 `renderMap()`에서 `!mapData || !mapData.nodes || mapData.nodes.length === 0` 조기 반환 분기 직전(또는 분기 내)에서 `nodes`·`links`를 빈 배열로 동기화한다( research.md 결정 1 ).
- [X] T003 [US1] `highlightSearchResults()`에서 첫 결과 포커스·줌 전에 `nodes`가 배열이며 필요 시 요소를 찾을 수 있는지 확인하고, 불가하면 하이라이트 집합/`updateNodeHighlight`만 수행하고 줌·selectNode는 생략한다.
- [X] T004 [US1] `selectAnchorNode` 등 동일 파일 내 `nodes.find` / `nodes.filter` 사용처를 점검해 동일 패턴으로 예외가 나지 않게 한다.

**Checkpoint**: T000이 `npm test`에서 통과하고, `quickstart.md` 필수 시나리오에서 콘솔 TypeError 재현 0건.

---

## Phase 2: User Story 2 — ready 맵에서 기존 탐색·강조 유지 (Priority: P2)

**Goal**: 회귀 없음(FR-003, SC-002).

**Independent Test**: `quickstart.md`의 "회귀 (SC-002)" 절.

### Verification

- [ ] T005 [US2] 노드가 있는 데이터로 검색 후 첫 결과 하이라이트·포커스·(기존과 동일한) 줌 동작이 수정 직전과 동등한지 수동 확인한다.

---

## Phase 3: Polish & 품질 게이트

- [X] T006 [POLISH] `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/quickstart.md` 의 `npm run lint`, `npm run type-check`, `npm test` 실행 및 통과(헌장 IV).

---

## Dependencies & Order

1. T000 → T001 → T002 → T003 → T004 (T000은 픽스 전 Red; 동일 파일 순차; 병렬 불가)
2. T005는 T000–T004 완료 후
3. T006는 마지막

## Parallel opportunities

- 없음(단일 JS 파일 직렬 수정).

## Notes

- T000에서 이미 헬퍼 분리·Vitest를 도입한 경우, 리팩터는 최소 범위로 유지한다(`plan.md` Complexity Tracking).
