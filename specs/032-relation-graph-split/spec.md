# Feature Specification: relation-graph.ts 분해

**Feature Branch**: `032-relation-graph-split`  
**Created**: 2026-06-29  
**Status**: Draft  
**Input**: GitHub Issue #595 — refactor(relation): relation-graph.ts 분해 (1235줄, 부모 #593)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 모듈 단위로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 관계 그래프 코드를 수정할 때 탐색(BFS)·순환 감지(DFS)·캐시·조회·변경(mutation) 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `relation-graph` 관련 vitest 전체 통과 + 각 sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `packages/memento-core/src/domains/relation/services/`, **When** `wc -l`로 줄 수 확인, **Then** 어떤 단일 파일도 500줄을 초과하지 않는다.
2. **Given** 기존 public API (`RelationGraph`, `createRelationGraph` import 경로), **When** import 경로 `relation-graph.js` 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — relation/search 동작 회귀 없음 (Priority: P1)

recall 랭킹·anchor map·hybrid search가 RelationGraph를 통해 관계를 조회·탐색할 때 기존과 동일한 BFS/DFS·캐시·배치 동작이 유지되어야 한다.

**Independent Test**: `relation-graph.spec.ts`, `relation-graph.integration.spec.ts` 전체 green.

**Acceptance Scenarios**:

1. **Given** 순환 참조 추가 시도, **When** `allowCyclic: false`, **Then** `CyclicRelationError` 발생 (기존과 동일).
2. **Given** N-hop 탐색, **When** `getRelatedMemories` 호출, **Then** hop_distance·relation_path 결과 동일.

### User Story 3 — graphify god node 완화 (Priority: P2)

개발자가 graphify 리포트에서 RelationGraph god node(23 edges) 부담이 분산된 모듈 구조로 확인할 수 있어야 한다.

**Independent Test**: graphify rebuild 후 RelationGraph 단일 파일 500줄 이하.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `relation-graph-cache.ts` — L1/L2 캐시 키 생성·인덱스·무효화.
- **FR-002**: `relation-graph-cycle-detector.ts` — DFS 순환 참조 감지.
- **FR-003**: `relation-graph-query.ts` — `getRelations`, `getRelationsBatch`.
- **FR-004**: `relation-graph-traversal.ts` — BFS N-hop `getRelatedMemories`.
- **FR-005**: `relation-graph-mutations.ts` — add/update/remove/batch 및 내부 CRUD 헬퍼.
- **FR-006**: `relation-graph-row-utils.ts` — RelationRow → MemoryRelation 매핑.
- **FR-007**: `relation-graph.ts` — 오케스트레이션·기존 public API 유지 (500줄 이하).

## Out of Scope

- IRelationGraph 인터페이스 변경
- 캐시 TTL·알고리즘 변경
- DB 스키마 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #595 완료 기준 2항목 충족
- **SC-002**: relation/search vitest 회귀 없음
- **SC-003**: `npm run build && npm test && npm run lint && npm run type-check` 통과
