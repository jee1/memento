# Feature Specification: remember 관계 추출용 기존 기억 조회 수정

**Feature Branch**: `issue-544-remember-embedding-fix`  
**Created**: 2026-06-18  
**Status**: Draft  
**Input**: GitHub Issue #544 — `[remember] 기존 기억 조회 실패: no such column: embedding`

## User Scenarios & Testing *(mandatory)*

### User Story 1 — remember 시 관계 추출이 기존 기억을 조회한다 (Priority: P1)

운영 DB 스키마에서 `memory_item`에 `embedding` 컬럼이 없고 임베딩은 `memory_embedding` 테이블에 저장된 상태에서, `remember` 호출 후 관계 추출 단계가 기존 기억 목록을 정상 조회해야 한다.

**Why this priority**: 현재 SQL 오류로 빈 배열이 반환되어 관계 추출이 매번 스킵되고 운영 warn 로그가 반복된다.

**Independent Test**: `embedding` 컬럼이 없는 `memory_item` 스키마에서 `getExistingMemoriesForRelationExtraction`이 기존 기억을 반환하고 `기존 기억 조회 실패` warn이 없다.

**Acceptance Scenarios**:

1. **Given** `memory_item`에 기존 기억 2건, **When** 새 기억 저장 후 관계 추출용 조회, **Then** 제외 ID 외 기존 기억이 1건 이상 반환된다.
2. **Given** 동일 조건, **When** 조회 실행, **Then** `no such column: embedding` 오류 및 `기존 기억 조회 실패` warn이 없다.
3. **Given** `getMemoryById`로 새 저장 기억 조회, **When** `memory_item`에 해당 행 존재, **Then** content/type 등 필드가 반환된다.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `getExistingMemoriesForRelationExtraction` SELECT는 현재 `memory_item` 스키마와 일치해야 하며 `embedding` 컬럼을 참조하지 않아야 한다.
- **FR-002**: `getMemoryById` SELECT도 동일하게 `embedding` 컬럼을 참조하지 않아야 한다.
- **FR-003**: 관계 추출 경로는 조회 실패 시 빈 배열 폴백을 유지하되, 정상 스키마에서는 폴백 없이 기존 기억을 사용해야 한다.

## Out of Scope

- `memory_embedding` JOIN으로 임베딩 후보 필터 품질 개선
- 스키마/마이그레이션 변경
- 관계 추출 알고리즘 자체 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #544 fingerprint 로그(`no such column: embedding`) 재발 없음
- **SC-002**: 회귀 테스트 통과
- **SC-003**: `npm run lint`, `npm run type-check`, `npm test` 통과
