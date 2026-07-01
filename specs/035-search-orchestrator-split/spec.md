# Feature Specification: search-orchestrator-split

**Feature Branch**: `035-search-orchestrator-split`  
**Created**: 2026-07-01  
**Status**: Implemented  
**Input**: GitHub Issue #611 — refactor(search): vector-search.repository.ts·search-engine.ts 분해 (부모 #593)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 모듈 단위로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 벡터 검색·텍스트 검색 코드를 수정할 때 KNN SQL·하이브리드 CTE·FTS5 fallback·랭킹 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `vector-search.repository.spec.ts`, `search-engine.spec.ts`, `search-engine-reflection-notes.spec.ts` 전체 통과 + 각 sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `vector-search/`·`search-engine/` 디렉터리, **When** `wc -l`로 줄 수 확인, **Then** 어떤 단일 파일도 500줄을 초과하지 않는다.
2. **Given** 기존 public API (`VectorSearchRepositoryImpl`, `SearchEngine`, `SearchQuery` import 경로), **When** import 경로 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — 검색 동작 회귀 없음 (Priority: P1)

KNN 벡터 검색, 하이브리드 CTE, FTS5 fallback, reflection_notes LIKE fallback, 랭킹·score_breakdown이 기존과 동일하게 동작해야 한다.

**Independent Test**: search domain vitest 회귀 스위트 green.

**Acceptance Scenarios**:

1. **Given** FTS5 미가용 환경, **When** `SearchEngine.search` 호출, **Then** LIKE fallback으로 결과 반환 (기존과 동일).
2. **Given** reflection_notes FTS5 미포함 스키마, **When** 검색, **Then** `m.reflection_notes LIKE ?` fallback (기존과 동일).

### User Story 3 — graphify god node 완화 (Priority: P2)

개발자가 graphify 리포트에서 VectorSearchRepositoryImpl·SearchEngine god node 부담이 분산된 모듈 구조로 확인할 수 있어야 한다.

**Independent Test**: graphify rebuild 후 orchestrator·sub-module 각 500줄 이하.

---

## Requirements *(mandatory)*

### Functional Requirements — vector-search

- **FR-001**: `vector-search.types.ts` — RawVectorSearchResult, RuntimeVectorContext, VectorSearchScope.
- **FR-002**: `vector-search-availability.ts` — checkVecAvailability, isVecTableRegistered, getIndexStatus, rebuildIndex.
- **FR-003**: `vector-search-runtime-context.ts` — resolveRuntimeVectorContext, alignQueryVector, 차원·테이블명.
- **FR-004**: `vector-search-scope.ts` — search/hybridSearch scope 파싱 중복 제거.
- **FR-005**: `vector-search-result-mapper.ts` — safeParseTags, mapKnnResults, mapHybridResults.
- **FR-006**: `vector-search-knn-query.ts` — KNN SQL 실행.
- **FR-007**: `vector-search-hybrid-query.ts` — hybrid CTE SQL 실행.
- **FR-008**: `vector-search.repository.ts` — composition 오케스트레이션 (500줄 이하).

### Functional Requirements — search-engine

- **FR-009**: `search-engine.types.ts` — SearchQuery(export), SearchEngineRow, BuildSearchStatementResult.
- **FR-010**: `search-engine-fts-query.ts` — buildFTSQuery, preprocessQuery, makeFTSSafe.
- **FR-011**: `search-engine-fts-availability.ts` — FTS5·reflection_notes 가용성, fallback 캐시.
- **FR-012**: `search-engine-ranking.ts` — applyRanking, breakdown, factBoost, recallReason.
- **FR-013**: `search-engine-sql-builder.ts` — buildSearchStatement.
- **FR-014**: `search-engine.ts` — search() 파이프라인 오케스트레이션 (500줄 이하).

## Out of Scope

- VectorSearchRepository·SearchEngine public 메서드 시그니처 변경
- 검색·랭킹 알고리즘 변경
- DB 스키마 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #611 완료 기준 충족 (orchestrator ≤500, sub-module ≤500)
- **SC-002**: FTS5 fallback + reflection_notes 회귀 테스트 green
- **SC-003**: `npm run build && npm run lint && npm run type-check` 통과
