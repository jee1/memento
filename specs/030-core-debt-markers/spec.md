# Feature Specification: core debt markers 정리

**Feature Branch**: `030-core-debt-markers`  
**Created**: 2026-06-28  
**Status**: Draft  
**Input**: GitHub Issue #586 — core debt markers (BUG/TODO/DEPRECATED/XXX) 정리 (부모 #580)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 프로덕션 경로 BUG/XXX 0건 (Priority: P1)

유지보수자가 `packages/memento-core/src` 프로덕션 경로(테스트·`__tests__` 제외)를 스캔할 때 의도적이지 않은 BUG/XXX 마커가 0건이어야 한다. 로그 레벨 `'debug'`·`logger.debug()` 등 false positive는 스캐너 allowlist로 제외한다.

**Independent Test**: `npm run check-debt-markers -- --production-only` exit 0, BUG/XXX 0건.

**Acceptance Scenarios**:

1. **Given** 2026-06-27 tech-debt-analyzer가 보고한 core BUG 위치(주석·문구), **When** 재스캔, **Then** `buggy`·`xxx.yyy` 등 false positive 문구가 제거·대체된다.
2. **Given** 프로덕션 소스, **When** check-debt-markers 실행, **Then** BUG·XXX actionable finding 0건.

### User Story 2 — DEPRECATED 마이그레이션 문서화 (Priority: P1)

개발자가 `@deprecated` API·런타임 레거시 경고의 대체 경로와 제거 일정을 문서에서 확인할 수 있어야 한다.

**Independent Test**: `docs/architecture/core-deprecated-inventory.md` 존재 + 스캐너가 inventory 등록 항목은 actionable에서 제외.

**Acceptance Scenarios**:

1. **Given** inventory 문서, **When** feedback-repository·performance-monitor·type-param-validator 항목 조회, **Then** 대체 API·일정이 명시된다.

### User Story 3 — obsolete 코드·shim 정리 (Priority: P2)

더 이상 import되지 않는 deprecated shim·마이그레이션 유틸을 제거하여 마커·유지 부담을 줄인다.

**Independent Test**: `vector-search-engine-migration.ts` 삭제 후 build/test green; remember-tool deprecated private shim 제거 후 relation-load 테스트가 db-helpers 직접 호출.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `scripts/check-debt-markers.ts` 추가 — memento-core 프로덕션 경로 actionable 마커 검사, allowlist(로그 레벨 `debug` 등).
- **FR-002**: BUG false positive 문구 수정(batch-scheduler·init·search-engine 주석, 012 rollback 주석, pii-masker JWT 주석).
- **FR-003**: `docs/architecture/core-deprecated-inventory.md` 작성 — @deprecated·런타임 레거시 경고 inventory.
- **FR-004**: 미사용 `vector-search-engine-migration.ts` 삭제.
- **FR-005**: remember-tool deprecated private shim 제거 + 테스트를 `remember-tool-db-helpers` 직접 사용으로 전환.
- **FR-006**: `npm run check-debt-markers` 루트 스크립트 등록.

## Out of Scope

- memento-server·scripts·static/js debt markers (#580 후속)
- logger.debug / `'debug'` log level API 변경
- @deprecated API 실제 제거(문서화·shim 정리만)

## Success Criteria *(mandatory)*

- **SC-001**: Issue #586 완료 기준 3항목 충족
- **SC-002**: `npm run check-debt-markers -- --production-only` 통과
- **SC-003**: `npm run build && npm test && npm run lint && npm run type-check` 통과
