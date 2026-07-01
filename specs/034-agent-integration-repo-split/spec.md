# Feature Specification: sqlite-agent-integration-repository.ts 분해

**Feature Branch**: `034-agent-integration-repo-split`  
**Created**: 2026-07-01  
**Status**: Draft  
**Input**: GitHub Issue #610 — refactor(db): sqlite-agent-integration-repository.ts 분해 (952줄, 부모 #619)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 책임별 sub-module로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 agent integration SQLite 저장소를 수정할 때 session·observation·promotion·provenance·row mapping 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `sqlite-agent-integration-repository.spec.ts` vitest 전체 통과 + 각 sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `packages/memento-core/src/infrastructure/database/repositories/`, **When** `wc -l`로 줄 수 확인, **Then** 어떤 단일 파일도 500줄을 초과하지 않는다.
2. **Given** 기존 public API (`SqliteAgentIntegrationRepository` import 경로), **When** import 경로 `sqlite-agent-integration-repository.js` 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — agent-integration 동작 회귀 없음 (Priority: P1)

agent lifecycle·session summary·memory promotion 서비스가 repository를 통해 세션·관측·승격·provenance를 조회·변경할 때 기존과 동일한 SQL·트랜잭션 동작이 유지되어야 한다.

**Independent Test**: `sqlite-agent-integration-repository.spec.ts` 및 agent-integration domain spec 전체 green.

**Acceptance Scenarios**:

1. **Given** promotion candidate 승인, **When** `approvePromotionCandidate` 호출, **Then** memory_item·memory_link·memory_provenance 생성 (기존과 동일).
2. **Given** 세션 목록 조회, **When** `listSessions` 호출, **Then** observation aggregate·cursor pagination 결과 동일.

### User Story 3 — graphify god node 완화 (Priority: P2)

개발자가 graphify 리포트에서 SqliteAgentIntegrationRepository god node(29 edges) 부담이 분산된 모듈 구조로 확인할 수 있어야 한다.

**Independent Test**: graphify rebuild 후 오케스트레이터 파일 500줄 이하.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `agent-integration-row-utils.ts` — Row types, row→domain 매핑, `normalizePromotionContent`.
- **FR-002**: `agent-integration-cursor-utils.ts` — observation/session cursor encode·decode, `emptySessionObservationAggregate`.
- **FR-003**: `agent-integration-session-store.ts` — session CRUD, `listSessions`, `getDashboardAggregate`, `markExpiredSessionsAbandoned`, `deleteSession`.
- **FR-004**: `agent-integration-observation-store.ts` — observation CRUD, listing, `clearExpiredObservationPayloads`.
- **FR-005**: `agent-integration-promotion-store.ts` — promotion candidate CRUD, approve/reject, `persistSessionSummary`, `findScopedMemoryByContent`.
- **FR-006**: `agent-integration-provenance-store.ts` — provenance CRUD, `markProvenanceSourceDeleted`, session export용 조회.
- **FR-007**: `sqlite-agent-integration-repository.ts` — composition 오케스트레이션·`AgentIntegrationRepository` 구현 (500줄 이하).

## Out of Scope

- `AgentIntegrationRepository` 인터페이스 변경
- DB 스키마 변경
- SQL 쿼리 로직 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #610 완료 기준 4항목 충족
- **SC-002**: agent-integration vitest 회귀 없음
- **SC-003**: `npm run build && npm test && npm run lint && npm run type-check` 통과
