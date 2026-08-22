# Feature Specification: database/init.ts 스키마 초기화 모듈화

**Feature Branch**: `issue-631-database-init-split`  
**Created**: 2026-07-04  
**Status**: Draft  
**Input**: GitHub Issue #631 — refactor(db): database/init.ts 스키마 초기화 모듈화 (713줄, 부모 #629)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 책임별 sub-module로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 DB 부트스트랩·스키마 초기화 경로를 수정할 때 레거시 스키마·VEC 테이블·마이그레이션·세션 설정 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `init.spec.ts` vitest 전체 통과 + 각 sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `packages/memento-core/src/infrastructure/database/sqlite/`, **When** `wc -l`로 줄 수 확인, **Then** `init.ts` 오케스트레이터 및 어떤 단일 파일도 500줄을 초과하지 않는다.
2. **Given** 기존 public API (`initializeDatabase`, `closeDatabase` import 경로), **When** import 경로 `init.js` 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — DB 초기화 동작 회귀 없음 (Priority: P1)

신규·기존 DB 초기화, 마이그레이션 실행, schema.sql baseline 기록, Core Memory 자동 로드가 기존과 동일하게 동작해야 한다.

**Independent Test**: `init.spec.ts`, `migrate.spec.ts`, `db-integrity-preflight.spec.ts` green.

**Acceptance Scenarios**:

1. **Given** 빈 파일 DB, **When** `initializeDatabase` 호출, **Then** schema.sql 적용 + 모든 증분 마이그레이션 버전 기록.
2. **Given** 손상된 기존 DB, **When** `initializeDatabase` 호출, **Then** 무결성 사전 검사 실패로 시작 중단.

### User Story 3 — migration 경로와의 경계 유지 (Priority: P1)

`migration/` 디렉터리의 MigrationDetector·MigrationRunner·개별 마이그레이션 모듈은 변경하지 않고, init 오케스트레이션이 이를 호출하는 경계만 유지해야 한다.

**Independent Test**: migration spec 회귀 없음.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `init-legacy-schema.ts` — 레거시 컬럼 추가, VEC 테이블 차원 정합, populateVecTables.
- **FR-002**: `init-sqlite-session.ts` — WAL/pragma, FTS5·sqlite-vec 확장, reflection_notes UDF.
- **FR-003**: `init-migration-baseline.ts` — schema.sql 적용 후 증분 마이그레이션 baseline 기록.
- **FR-004**: `init-migrate-existing.ts` — 기존 DB pending 마이그레이션 실행.
- **FR-005**: `init-bootstrap-new-db.ts` — 신규 DB schema.sql·마이그레이션 우선 전략.
- **FR-006**: `init.ts` — 오케스트레이션 (`initializeDatabase`, `closeDatabase`, CLI) 500줄 이하.

## Out of Scope

- `migration/` 하위 모듈 변경
- DB 스키마 변경
- public export surface 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #631 완료 기준 4항목 충족
- **SC-002**: `npm run lint && npm run type-check && npm test` 통과
- **SC-003**: `npm run db:pre-docker-deploy` 무결성 점검 통과
