# Feature Specification: scheduler-orchestrator-split

**Feature Branch**: `036-scheduler-orchestrator-split`  
**Created**: 2026-07-01  
**Status**: Implemented  
**Input**: GitHub Issue #612 — refactor(scheduler): batch-scheduler.ts·triple-extraction-batch-job.ts 분해 (부모 #593)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 모듈 단위로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 배치 스케줄러·Triple 추출 배치 작업 코드를 수정할 때 로깅·컨텍스트·진단·인터벌·통계·헬스체크·재시도·청크 처리 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: `batch-scheduler/*.spec.ts`, `triple-extraction-batch-job.spec.ts` 전체 통과 + 각 orchestrator·sub-module 파일이 500줄 이하.

**Acceptance Scenarios**:

1. **Given** 분리 후 `batch-scheduler/`·`triple-extraction-batch-job/` 디렉터리, **When** `wc -l`로 줄 수 확인, **Then** orchestrator 파일(`batch-scheduler.ts`, `triple-extraction-batch-job.ts`)이 500줄 이하이고 sub-module도 500줄 이하이다.
2. **Given** 기존 public API (`BatchScheduler`, `TripleExtractionBatchJob`, singleton import 경로), **When** import 경로 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — 스케줄러 동작 회귀 없음 (Priority: P1)

anchor auto-refresh, recurring job registration, triple extraction 배치, diagnostics, memory_review_candidates 기록이 기존과 동일하게 동작해야 한다.

**Independent Test**: scheduler domain vitest 회귀 스위트 green.

**Acceptance Scenarios**:

1. **Given** BatchScheduler start/stop, **When** recurring jobs 등록, **Then** cleanup·monitoring·healthcheck·anchor_auto_refresh 등 기존 스케줄 유지.
2. **Given** TripleExtractionBatchJob execute, **When** 재시도·청크·타임아웃 처리, **Then** 기존과 동일한 상태 전이·로깅.

### User Story 3 — graphify god node 완화 (Priority: P2)

개발자가 graphify 리포트에서 BatchScheduler·TripleExtractionBatchJob god node 부담이 분산된 모듈 구조로 확인할 수 있어야 한다.

**Independent Test**: graphify rebuild 후 orchestrator·sub-module 각 500줄 이하.

---

## Requirements *(mandatory)*

### Functional Requirements — batch-scheduler

- **FR-001**: `batch-scheduler-logging.ts` — log() 로직.
- **FR-002**: `batch-scheduler-context.ts` — buildRunContext(), buildRecurringScheduleContext().
- **FR-003**: `batch-scheduler-diagnostics.ts` — writeDiagnosticsEvent, emitMemoryReviewCandidatesRunRecord.
- **FR-004**: `batch-scheduler-interval.ts` — scheduleJob, waitForRunningJobs helpers.
- **FR-005**: `batch-scheduler-stats.ts` — getDetailedStats logic.
- **FR-006**: `batch-scheduler-health.ts` — checkSchedulerHealth.
- **FR-007**: `batch-scheduler-singleton.ts` — getBatchScheduler, createBatchScheduler, resetBatchScheduler (re-export from main).
- **FR-008**: `batch-scheduler.ts` — composition 오케스트레이션 (500줄 이하).

### Functional Requirements — triple-extraction-batch-job

- **FR-009**: `triple-extraction-batch-job.types.ts` — config/result interfaces + getErrorCode.
- **FR-010**: `triple-extraction-batch-job-retry.ts` — getTargetMemories, shouldRetry, getRetryCount.
- **FR-011**: `triple-extraction-batch-job-chunk.ts` — splitIntoChunks, processChunk.
- **FR-012**: `triple-extraction-batch-job-memory-status.ts` — updateMemoryStatus, calculateAverageConfidence.
- **FR-013**: `triple-extraction-batch-job.ts` — execute() 파이프라인 오케스트레이션 (500줄 이하).
- **FR-014**: `BatchJobResult` import는 `batch-scheduler-types.js` 사용 (순환 의존 방지).

## Out of Scope

- BatchScheduler·TripleExtractionBatchJob public 메서드 시그니처 변경
- 스케줄링·재시도·Triple 추출 알고리즘 변경
- DB 스키마 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #612 완료 기준 충족 (orchestrator ≤500, sub-module ≤500)
- **SC-002**: batch-scheduler + triple-extraction 회귀 테스트 green
- **SC-003**: `npm run build && npm run lint && npm run type-check` 통과
