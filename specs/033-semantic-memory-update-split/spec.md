# Feature Specification: semantic-memory-update-service.ts 분해

**Feature Branch**: `033-semantic-memory-update-split`  
**Created**: 2026-06-30  
**Status**: Draft  
**Input**: GitHub Issue #598 — refactor(memory): semantic-memory-update-service.ts 분해 (1168줄, 부모 #593)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 모듈 단위로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 semantic memory 업데이트 코드를 수정할 때 update pipeline·embedding hook·consolidation score·relation·CRUD 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `semantic-memory-update-service.spec.ts` 전체 통과 + 각 sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `packages/memento-core/src/domains/memory/services/semantic-memory/`, **When** `wc -l`로 줄 수 확인, **Then** 어떤 단일 파일도 500줄을 초과하지 않는다.
2. **Given** 기존 public API (`SemanticMemoryUpdateService`, import 경로 `semantic-memory-update-service.js`), **When** import 경로 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — semantic memory 동작 회귀 없음 (Priority: P1)

Triple 추출 결과로 semantic memory 생성·업데이트·중복 병합·KG dedupe·episodic relation 생성이 기존과 동일하게 동작해야 한다.

**Independent Test**: `semantic-memory-update-service.spec.ts` 전체 green.

**Acceptance Scenarios**:

1. **Given** confidence가 임계값 미만인 triple, **When** `updateSemanticMemory` 호출, **Then** skipped 증가 (기존과 동일).
2. **Given** 동일 (s,p,o) kg_triple 존재, **When** 업데이트, **Then** 대표 memory 재사용 (Issue #90).

### User Story 3 — graphify god node 완화 (Priority: P2)

개발자가 graphify 리포트에서 SemanticMemoryUpdateService god node(23 edges) 부담이 분산된 모듈 구조로 확인할 수 있어야 한다.

**Independent Test**: graphify rebuild 후 단일 파일 500줄 이하.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `semantic-memory-update-types.ts` — 공유 타입·상수·ID 생성.
- **FR-002**: `semantic-memory-scoring.ts` — confidence·importance·자연어 변환·KG 정규화.
- **FR-003**: `semantic-memory-similarity.ts` — 중복 검색·임베딩 유사도·cosine similarity.
- **FR-004**: `semantic-memory-crud.ts` — semantic memory 생성·병합 업데이트.
- **FR-005**: `semantic-memory-relations.ts` — relation type 등록·방향 검증·episodic edge.
- **FR-006**: `semantic-memory-update-pipeline.ts` — validate·prepare·apply·processSingleTriple·notify.
- **FR-007**: `semantic-memory-update-service.ts` — composition 오케스트레이션·기존 public API 유지 (500줄 이하).

## Out of Scope

- SemanticMemoryUpdateService public 메서드 시그니처 변경
- confidence/similarity 알고리즘 변경
- DB 스키마 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #598 완료 기준 2항목 충족
- **SC-002**: semantic memory vitest 회귀 없음
- **SC-003**: `npm run build && npm test && npm run lint && npm run type-check` 통과
