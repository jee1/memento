# Feature Specification: infrastructure-refactor

**Feature Branch**: `037-infrastructure-refactor`
**Created**: 2026-07-02
**Status**: In Progress
**Input**: GitHub Issue #615 — refactor(infrastructure): async-optimizer + reflexion-procedural-memory-service complexity (부모 #619)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 유지보수자가 모듈 단위로 변경 범위를 좁힌다 (Priority: P1)

유지보수자가 async-optimizer·reflexion-procedural-memory-service 코드를 수정할 때 큐·워커·파서·배치 처리·추출·업데이트 모드 로직이 별도 sub-module로 분리되어 있어, 변경 시 회귀 범위를 파일 단위로 제한할 수 있어야 한다.

**Independent Test**: orchestrator 파일 `wc -l` ≤500 + reflexion·async path specs green.

**Acceptance Scenarios**:

1. **Given** 분리 후 `async-optimizer/`·`reflexion-procedural-memory-service/` 디렉터리, **When** `wc -l`로 줄 수 확인, **Then** `async-optimizer.ts` orchestrator가 500줄 이하이다.
2. **Given** 기존 public API (`AsyncTaskQueue`, `BatchProcessor`, `Task`, `TaskResult`, `QueueStats`, `ReflexionProceduralMemoryService`), **When** import 경로 유지, **Then** 외부 호출부 변경 없이 빌드·테스트 통과.

### User Story 2 — reflexion·async 경로 회귀 없음 (Priority: P1)

FailureDetector·ReflexionWorker 비동기 경로가 기존과 동일하게 동작해야 한다.

**Independent Test**: `reflexion-worker.spec.ts`, `failure-detector.spec.ts` green.

**Acceptance Scenarios**:

1. **Given** AsyncTaskQueue failure_event 작업, **When** handler 실행, **Then** 기존과 동일한 처리·재시도 동작.
2. **Given** reflection_notes procedural 변환, **When** replace/incremental/versioned 모드, **Then** 기존 DB 업데이트·버전 링크 동작 유지.

### User Story 3 — reflexion updateProceduralMemory 복잡도 감소 (Priority: P1)

`updateProceduralMemory` 중첩 깊이 ≤4, cyclomatic complexity ≤10.

**Independent Test**: ESLint complexity 규칙 통과 + 기존 reflexion specs green.

---

## Requirements *(mandatory)*

### Functional Requirements — async-optimizer

- **FR-001**: `async-optimizer.types.ts` — Task, TaskResult, QueueStats interfaces.
- **FR-002**: `async-optimizer-parsers.ts` — failedTaskDataToTaskFields, parseMemoryOperationTaskData, parseFailureEventTaskData.
- **FR-003**: `async-task-queue.ts` — AsyncTaskQueue class.
- **FR-004**: `async-task-worker.ts` — Worker class (AsyncTaskQueue type import).
- **FR-005**: `batch-processor.ts` — BatchProcessor class.
- **FR-006**: `async-optimizer.ts` — thin re-export orchestrator (≤500 lines).

### Functional Requirements — reflexion-procedural-memory-service

- **FR-007**: `reflexion-procedural-extraction.ts` — LLM vs rule extraction from convert().
- **FR-008**: `reflexion-procedural-create.ts` — createProceduralMemory logic.
- **FR-009**: `reflexion-procedural-update-replace.ts` — replace mode.
- **FR-010**: `reflexion-procedural-update-incremental.ts` — incremental mode + mergeSteps.
- **FR-011**: `reflexion-procedural-update-versioned.ts` — versioned mode.
- **FR-012**: `reflexion-procedural-memory-service.ts` — ReflexionProceduralMemoryService orchestrator (convert, updateProceduralMemory public API 유지).

## Out of Scope

- Public API 시그니처 변경
- 큐·배치·procedural 변환 알고리즘 변경
- DB 스키마 변경

## Success Criteria *(mandatory)*

- **SC-001**: Issue #615 acceptance criteria 충족 (async-optimizer orchestrator ≤500, reflexion nesting ≤4 / complexity ≤10)
- **SC-002**: reflexion·async path specs green
- **SC-003**: `npm run lint && npm run type-check && npm test` 통과
