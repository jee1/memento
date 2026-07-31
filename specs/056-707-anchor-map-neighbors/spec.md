# Feature Specification: Epic #707 Anchor Map 이웃 지식 복구

**Feature Branch**: `056-707-anchor-map-neighbors` (이슈별 worktree/PR로 분할)
**Created**: 2026-07-31
**Status**: Draft → Implementing
**Parent Epic**: #707
**Input**: Dashboard Anchor Map slot에 이웃 지식이 보이지 않음 — relationGraph 배선·map 정합·cosine 계약·보강

---

## Scope

| Issue | Title | Priority | Epic 필수 | PR |
|-------|-------|----------|-----------|-----|
| #708 | bootstrap `relationGraph` → `AnchorSearchService` 배선 | P0 | ✅ | 별도 |
| #709 | Anchor Map `buildNetworkLinks`를 `memory_relation` 정합 | P1 | ✅ | 별도 |
| #713 | sqlite-vec **cosine** metric ↔ similarity 계약 | P1.5 | ✅ | 별도 |
| #710 | semantic 이웃 임베딩 생성·backfill | P2 | ✅ | 별도 |
| #711 | `runRelationExtraction` persist | P2 | ✅ | 별도 |
| #714 | auto-anchor 고립 방지 | P2 hardening | ❌ | 별도 |
| #715 | hop 2/3 path edge + provenance | follow-up | ❌ | 별도 |
| #712 | `getRelationTypeBoost` 타입 명시 | — | **보류** | 스킵 |

**권장 순서:** `#708 → #709 → #713 → #710` · `#711`은 `#708` 이후 병렬 · `#714`/`#715` 별도

---

## Problem Statement

관계가 없는 게 아니라, **있는 관계(`memory_relation` 5만+)가 Anchor Map 검색/표시 경로에 안 꽂혀 있음**. `memory_link`는 0건. 추가로 sqlite-vec 기본 L2 vs cosine-like similarity 계약 불일치.

## Goals

- Slot A/B map에 semantic 이웃 노드·엣지 복구 (`memory_link` 0이어도)
- Vector 경로 cosine 계약 정합 (#713) 후 semantic embedding 보강 (#710)
- remember 시 relation 추출 persist (#711)
- (선택) C slot 고립 완화 (#714), hop≥2 path edge (#715)

## Non-Goals

- `memory_relation` → `memory_link` 이중 기록
- Slot threshold만 낮춰 증상 가리기 / UI-only 패치
- #712 boost 튜닝
- #709에서 hop 2/3 path edge (#715로 분리)

---

## User Scenarios & Testing

### User Story 1 — Slot 이웃 복구 (#708 + #709) (Priority: P1)

운영자/에이전트가 Dashboard Anchor Map을 열면, 앵커 A/B에 연결된 semantic 이웃이 노드와 선으로 보인다.

**Why this priority**: 직접 원인(배선 + link 소스) 수정으로 즉시 증상 해소.

**Independent Test**: `memory_link` 비어 있고 `memory_relation`만 있는 fixture에서 `searchLocal`/map API가 이웃을 반환.

**Acceptance Scenarios**:

1. **Given** bootstrap 완료, **When** Slot A `searchLocal`, **Then** `memory_relation` outgoing semantic target 포함
2. **Given** `memory_link`=0, **When** `/api/anchors/map`, **Then** memory node + edge ≥1
3. **Given** 동일 memory가 A·B 검색 결과, **When** map 빌드, **Then** node 1개 + slot edge 2개 (A→m, B→m)

### User Story 2 — Cosine 벡터 계약 (#713) (Priority: P2)

벡터 검색 similarity가 cosine으로 계약되고, fresh/기존 DB 모두 vec table·trigger가 정합한다.

**Acceptance Scenarios**:

1. **Given** fresh DB, **When** vec table 생성, **Then** `distance_metric=cosine`
2. **Given** 기존 DB, **When** versioned migration, **Then** 전 vec table 재생성·재적재·trigger 정합
3. **Given** 양의 비례 벡터, **When** KNN, **Then** similarity ≈ 1.0

### User Story 3 — 임베딩·persist 보강 (#710 + #711) (Priority: P3)

신규 semantic에 임베딩이 생기고, hybrid relation 추출이 `memory_relation`에 남는다.

**Acceptance Scenarios**:

1. **Given** triple→semantic 생성, **When** 완료, **Then** embedding row 존재(실패 시 remember 비차단)
2. **Given** extract 후보, **When** remember, **Then** `addRelationsBatch`로 persist + 재실행 멱등

### User Story 4 — Hardening (#714 + #715) (Priority: P4)

고립 auto-anchor 후보를 피하고, hop≥2는 실제 path edge로 연결한다.

---

## Requirements (Measurable)

### Functional
- **FR-708**: `initializeServices`가 `anchorSearchService.setRelationGraph(relationGraph)` (+ 권장 `hybridSearchEngine.setRelationGraph`) 호출
- **FR-709**: map link는 `RelationGraph`/`memory_relation` 기준; node dedup ≠ edge 생성 분리; hop≥2 path edge 미구현
- **FR-713**: 전 vec table `distance_metric=cosine`; mapper cosine distance→similarity; fresh+migration
- **FR-710**: semantic 임베딩 fire-and-forget + 제한 backfill (#713 이후)
- **FR-711**: `addRelationsBatch` + idempotency + remember 비차단
- **FR-714**: relation∧embedding 모두 0인 후보만 감점
- **FR-715**: predecessor/path provenance로 실제 path edge만 생성

### Success Criteria (Epic)
- [ ] 앵커 A/B map API에 semantic 이웃 ≥1
- [ ] `memory_link` 0이어도 동작
- [ ] bootstrap wiring + map 회귀 테스트
- [ ] cosine 계약·migration (#713)
- [ ] Dashboard 1-hop 육안 확인 가능

---

## Out of Scope / Deferred
- #712
- L2 유지 + threshold 재보정
