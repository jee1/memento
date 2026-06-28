# Feature Specification: performance-monitor.ts 분해

**Feature Branch**: `031-performance-monitor-split`  
**Created**: 2026-06-28  
**Status**: Draft  
**Input**: GitHub Issue #594 — refactor(monitoring): performance-monitor.ts 분해 (1198줄, 부모 #593)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 모듈 단위로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 성능 모니터링 코드를 수정할 때 CPU·메모리·알림·검색 통계·DB 메트릭·집계 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `performance-monitor` 관련 vitest 전체 통과 + 각 sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `packages/memento-core/src/domains/monitoring/services/`, **When** `wc -l`로 줄 수 확인, **Then** 어떤 단일 파일도 500줄을 초과하지 않는다.
2. **Given** 기존 public API (`PerformanceMonitor`, `getPerformanceMonitor`, `createPerformanceMonitor`, exported types), **When** import 경로 `performance-monitor.js` 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — 알림·메트릭 동작 회귀 없음 (Priority: P1)

운영자가 메모리/CPU/DB/쿼리 알림과 메트릭 수집·집계를 사용할 때 기존과 동일한 임계값·dual-baseline CPU·query resolve window 동작이 유지되어야 한다.

**Independent Test**: `performance-monitor.spec.ts` 전체 green.

**Acceptance Scenarios**:

1. **Given** `heapUsagePercent` deprecated 필드, **When** `getMemoryMetrics()` 호출, **Then** `heapShareOfBudgetPercent`와 동일 값 반환 (inventory 정합).
2. **Given** CPU dual-baseline (tick true/false), **When** 기존 spec 시나리오 실행, **Then** 동일 assertion 통과.

### User Story 3 — deprecated inventory 정합 (Priority: P2)

개발자가 `docs/architecture/core-deprecated-inventory.md`에서 PerformanceMonitor deprecated API 위치를 분리 후 모듈 경로와 일치하게 확인할 수 있어야 한다.

**Independent Test**: inventory 문서에 memory-metrics 모듈 경로 반영.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `performance-monitor-types.ts` — `PerformanceMetrics`, `AlertThresholds`, `PerformanceAlert` 타입 분리.
- **FR-002**: `memory-pressure-utils.ts` — cgroup/호스트 메모리 분모·비율·`formatBytes`.
- **FR-003**: `cpu-usage-tracker.ts` — dual-baseline CPU 사용률 계산.
- **FR-004**: `search-metrics-store.ts` — 검색 통계 record/get/reset.
- **FR-005**: `database-metrics-reader.ts` — DB 메트릭 조회·VACUUM/ANALYZE 최적화.
- **FR-006**: `performance-alert-manager.ts` — 임계값 판정·알림 상태·critical 처리 훅.
- **FR-007**: `performance-analytics.ts` — 트렌드·analytics·recommendations·summary.
- **FR-008**: `performance-monitor.ts` — 오케스트레이션·싱글톤·기존 public API re-export (500줄 이하).
- **FR-009**: `core-deprecated-inventory.md` — `heapUsagePercent` 위치를 memory 모듈로 갱신.

## Out of Scope

- `@deprecated heapUsagePercent` 필드 제거 (inventory 유지)
- BatchScheduler 결합도 변경
- 새 알림 채널·임계값 기본값 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #594 완료 기준 3항목 충족
- **SC-002**: monitoring vitest 회귀 없음
- **SC-003**: `npm run build && npm test && npm run lint && npm run type-check` 통과
