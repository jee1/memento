# Issue #224 — batch-scheduler 2차 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `batch-scheduler.ts`에서 `run*` 실행 본문과 반복 스케줄 등록을 `scheduler/handlers/` 및 `batch-recurring-schedules.ts`로 옮겨 God object를 줄이되, 공개 API·동작·테스트 회귀는 유지한다.

**Architecture:** `BatchScheduler`가 `buildRunContext()`로 좁은 `BatchSchedulerRunContext`를 매 실행마다 조립해 export된 핸들러 함수에 넘긴다. `handlers/*`는 `batch-scheduler.ts`를 import하지 않는다. 시간대·요일 체크 후 `intervals`에 등록하는 특수 스케줄은 `BatchRecurringRegistrationContext`로 `jobExecutionCoordinator.addJobToQueue`·`lastExecution`·`intervals.set`에 접근한다.

**Tech Stack:** TypeScript 5.x, Vitest, 기존 `packages/memento-core` 스케줄러·`BatchJobExecutionCoordinator`, `better-sqlite3`.

**Spec:** `docs/superpowers/specs/2026-05-10-issue-224-batch-scheduler-handlers-design.md` (브랜치 `issue/224-batch-scheduler-refactor` 동일 경로).

---

## 파일 맵 (신규·변경)

| 경로 | 역할 |
|------|------|
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-run-context.ts` | 핸들러용 컨텍스트 타입·mutable job ref 등 |
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-maintenance-handlers.ts` | `runMemoryCleanup`, `runMonitoring`, `runHealthCheck` + `countMonitoringAlertBuckets` 로컬 함수 |
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-review-meta-handlers.ts` | `runMemoryReviewCandidatesJob`, `buildMemoryReviewCandidateUpsertInputs`, `runMetaMemoryIntrospection` |
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-consolidation-relation-handlers.ts` | consolidation score incremental/full sweep, `runWeeklyRelationValidation`, `runLogRotation` |
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-augmentation-handlers.ts` | `runTripleExtractionBatch`, `runQualityMeasurementBatch` |
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-sleep-telemetry-handlers.ts` | `runSleepConsolidationBatch`, `runTelemetryCleanupBatch` |
| `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-memory-review-diagnostics.ts` (선택) | `emitMemoryReviewCandidatesRunRecord`만 덩치가 크면 분리; 아니면 review-meta 파일에 유지 |
| `packages/memento-core/src/infrastructure/scheduler/batch-recurring-schedules.ts` | `scheduleAllRecurringJobs` 및 모든 `schedule*` 묶음·특수 interval 등록 |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` | 위임·`buildRunContext`·`scheduleJob`·라이프사이클 유지, 줄 수 대폭 감소 |

**테스트 (회귀):** `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts`, `batch-scheduler-consolidation-score.spec.ts`, `jobs/__tests__/*` 관련 스펙.

---

### Task 0: 기준선 검증

**Files:** (읽기만)

- [ ] **Step 1: 워크트리에서 코어 스케줄러 테스트 실행**

```bash
cd /home/jee1lee/git/memento/.worktrees/issue-224-batch-scheduler
npm test --workspace @memento/core -- --run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts
```

**Expected:** 전부 PASS.

- [ ] **Step 2: 린트**

```bash
npm run lint
```

**Expected:** PASS.

---

### Task 1: `BatchSchedulerRunContext` 타입과 `buildRunContext`

**Files:**
- Create: `packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-run-context.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`

- [ ] **Step 1: 컨텍스트 타입 추가**

`batch-scheduler-run-context.ts`에 아래 형태로 정의한다. 필드명은 구현 시 `batch-scheduler.ts`의 private 사용처와 1:1로 맞춘다.

```typescript
import type Database from 'better-sqlite3';
import type { BatchJobConfig, BatchJobResult } from '../batch-scheduler-types.js';
import type { ForgettingPolicyService } from '../../../domains/forgetting/services/forgetting-policy-service.js';
import type { JobQueue } from '../job-queue.js';
import type { HealthChecker } from '../health-checker.js';
import type { FileLogger } from '../file-logger.js';
import type { RelationValidatorExecutor } from '../relation-validator-executor.js';
import type { ConsolidationScoreWorker } from '../../../workers/consolidation-score-worker.js';
import type { IntrospectionScanCache } from '../../../domains/memory/services/introspection-scan-cache.js';
import type { TripleExtractionBatchJob } from '../jobs/triple-extraction-batch-job.js';
import type { QualityMeasurementBatchJob } from '../jobs/quality-measurement-batch-job.js';
import type { SleepConsolidationBatchJob } from '../jobs/sleep-consolidation-batch-job.js';
import type { TelemetryCleanupBatchJob } from '../jobs/telemetry-cleanup-batch-job.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { PerformanceMonitor } from '../../../domains/monitoring/services/performance-monitor.js';

/** 로그 시 batch-scheduler.log와 동일 시그니처 유지 */
export type BatchSchedulerLogMethod = (
  message: string,
  data?: unknown,
  level?: 'info' | 'warn' | 'error'
) => void;

export type MutableJobRef<T> = { current: T | null };

export interface BatchSchedulerRunContext {
  readonly db: Database.Database | null;
  readonly config: BatchJobConfig;
  readonly forgettingService: ForgettingPolicyService;
  readonly performanceMonitor: PerformanceMonitor;
  readonly healthChecker: HealthChecker;
  readonly jobQueue: JobQueue;
  readonly fileLogger: FileLogger;
  readonly relationValidatorExecutor: RelationValidatorExecutor;
  readonly consolidationScoreWorker: ConsolidationScoreWorker | null;
  readonly introspectionScanCache: IntrospectionScanCache | null;
  readonly sleepConsolidationService: SleepConsolidationService | null;
  readonly telemetryCleanupRepository: TelemetryRepository | null;
  readonly tripleExtractionBatchJob: MutableJobRef<TripleExtractionBatchJob>;
  readonly qualityMeasurementBatchJob: MutableJobRef<QualityMeasurementBatchJob>;
  readonly sleepConsolidationBatchJob: MutableJobRef<SleepConsolidationBatchJob>;
  readonly telemetryCleanupBatchJob: MutableJobRef<TelemetryCleanupBatchJob>;
  readonly lastExecution: Map<string, Date>;
  readonly totalExecutions: Map<string, number>;
  log: BatchSchedulerLogMethod;
  emitMemoryReviewCandidatesRunRecord: (result: BatchJobResult) => Promise<void>;
}
```

- [ ] **Step 2: `BatchScheduler`에 `private buildRunContext(): BatchSchedulerRunContext` 구현**

`MutableJobRef`에는 `this.tripleExtractionBatchJob` 등을 `current`로 연결한다. `log`는 `this.log.bind(this)` 또는 화살표로 `this` 캡처.

- [ ] **Step 3: 테스트**

```bash
npm test --workspace @memento/core -- --run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts
```

**Expected:** PASS.

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-run-context.ts packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts
git commit -m "refactor(scheduler): add BatchSchedulerRunContext for handler extraction"
```

---

### Task 2: 유지보수 핸들러 분리

**Files:**
- Create: `handlers/batch-scheduler-maintenance-handlers.ts`
- Modify: `batch-scheduler.ts` (본문 삭제·`runMemoryCleanup` 등은 `await runMemoryCleanup(this.buildRunContext())` 패턴)

- [ ] **Step 1: `runMemoryCleanup`/`runMonitoring`/`runHealthCheck` 본문 이동**

`batch-scheduler.ts` 해당 메서드 블록(대략 L397–608)을 그대로 복사해 다음 시그니처로 export한다.

```typescript
export async function runMemoryCleanup(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> { /* 기존 본문, this→ctx */ }
export async function runMonitoring(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> { /* ... */ }
export async function runHealthCheck(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> { /* ... */ }
```

`countMonitoringAlertBuckets`는 동일 파일 하단 `function countMonitoringAlertBuckets(...)` private 모듈 스코프로 둔다.

- [ ] **Step 2: `BatchScheduler` private 메서드를 래퍼로 교체**

```typescript
private async runMemoryCleanup(): Promise<BatchJobResult> {
  return runMemoryCleanup(this.buildRunContext());
}
```

동일 패턴으로 monitoring·healthcheck.

- [ ] **Step 3: 테스트·커밋**

```bash
npm test --workspace @memento/core -- --run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts
git add packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-maintenance-handlers.ts packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts
git commit -m "refactor(scheduler): extract maintenance batch handlers"
```

---

### Task 3: 리뷰·메타 핸들러 분리

**Files:**
- Create: `handlers/batch-scheduler-review-meta-handlers.ts`
- Modify: `batch-scheduler.ts`

- [ ] **Step 1:** `buildMemoryReviewCandidateUpsertInputs`, `runMemoryReviewCandidatesJob`, `runMetaMemoryIntrospection` 및 `emitMemoryReviewCandidatesRunRecord`가 `runMemoryReviewCandidatesJob`만 쓰면 후자 파일에 같이 두고, 컨텍스트에 `emitMemoryReviewCandidatesRunRecord`가 이미 있으면 핸들러에서 `ctx.emitMemoryReviewCandidatesRunRecord(result)` 호출.

- [ ] **Step 2:** `buildRunContext`에 위 메서드 바인딩이 필요하면 `RunContext`에 필드 추가(역참조 없이 함수만 전달).

- [ ] **Step 3:** `runJob`의 `switch`는 `await runMemoryCleanup(ctx)` 대신 기존 private 래퍼 유지해도 됨(동일).

- [ ] **Step 4:** `npm test` 동일 경로 + 커밋 `refactor(scheduler): extract review and meta-memory handlers`

---

### Task 4: 콘솔리데이션·관계·로그 핸들러 분리

**Files:**
- Create: `handlers/batch-scheduler-consolidation-relation-handlers.ts`
- Modify: `batch-scheduler.ts`

- [ ] **Step 1:** `runConsolidationScoreIncremental`, `runConsolidationScoreFullSweep`, `runWeeklyRelationValidation`, `runLogRotation` 본문 이동·export.

- [ ] **Step 2:** 래퍼 연결 및 `npm test --workspace @memento/core -- --run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler-consolidation-score.spec.ts`

- [ ] **Step 3:** 커밋 `refactor(scheduler): extract consolidation relation and log rotation handlers`

---

### Task 5: 증강(트리플·품질) 핸들러 분리

**Files:**
- Create: `handlers/batch-scheduler-augmentation-handlers.ts`
- Modify: `batch-scheduler.ts`

- [ ] **Step 1:** `runTripleExtractionBatch`, `runQualityMeasurementBatch` 이동. `this.tripleExtractionBatchJob` 할당은 `ctx.tripleExtractionBatchJob.current = new TripleExtractionBatchJob(...)` 형태로 교체.

- [ ] **Step 2:** 테스트에 `jobs/__tests__/triple-extraction-batch-job.spec.ts`, `quality-measurement-batch-job.spec.ts`가 있으면 함께 실행.

```bash
npm test --workspace @memento/core -- --run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/quality-measurement-batch-job.spec.ts
```

- [ ] **Step 3:** 커밋 `refactor(scheduler): extract augmentation batch handlers`

---

### Task 6: 슬립·텔레메트리 핸들러 분리

**Files:**
- Create: `handlers/batch-scheduler-sleep-telemetry-handlers.ts`
- Modify: `batch-scheduler.ts`

- [ ] **Step 1:** `runSleepConsolidationBatch`, `runTelemetryCleanupBatch` 이동. `runTelemetryCleanupBatch` 반환 타입은 `Promise<void>` 유지.

- [ ] **Step 2:** `npm test --workspace @memento/core -- --run packages/memento-core/src/infrastructure/scheduler/jobs/sleep-consolidation-batch-job.spec.ts packages/memento-core/src/infrastructure/scheduler/jobs/telemetry-cleanup-batch-job.spec.ts` (경로는 저장소 실제 경로에 맞게 조정)

- [ ] **Step 3:** 커밋 `refactor(scheduler): extract sleep and telemetry handlers`

---

### Task 7: `batch-recurring-schedules.ts`로 스케줄 등록 이전

**Files:**
- Create: `packages/memento-core/src/infrastructure/scheduler/batch-recurring-schedules.ts`
- Modify: `batch-scheduler.ts`

- [ ] **Step 1: 등록 컨텍스트 타입 정의** (`batch-recurring-schedules.ts` 상단)

```typescript
import type { BatchJobConfig, BatchJobResult } from './batch-scheduler-types.js';
import type { BatchJobExecutionCoordinator } from './batch-job-execution-coordinator.js';

export interface BatchRecurringRegistrationContext {
  readonly config: BatchJobConfig;
  readonly consolidationScoreEnabled: boolean;
  readonly hasConsolidationScoreWorker: boolean;
  readonly hasSleepConsolidation: boolean;
  readonly hasTelemetryCleanup: boolean;
  readonly lastExecution: Map<string, Date>;
  readonly intervals: Map<string, ReturnType<typeof setInterval>>;
  scheduleJob: (name: string, interval: number, job: () => Promise<void>, priority: number) => void;
  jobExecutionCoordinator: BatchJobExecutionCoordinator;
  /** consolidation full sweep / weekly relation / triple hourly / quality hourly 등에서 사용 */
  addInterval: (key: string, intervalId: ReturnType<typeof setInterval>) => void;
  log: (message: string, data?: unknown, level?: 'info' | 'warn' | 'error') => void;
  runMemoryCleanup: () => Promise<BatchJobResult>;
  runMonitoring: () => Promise<BatchJobResult>;
  runHealthCheck: () => Promise<BatchJobResult>;
  runConsolidationScoreIncremental: () => Promise<BatchJobResult>;
  runConsolidationScoreFullSweep: () => Promise<BatchJobResult>;
  runWeeklyRelationValidation: () => Promise<BatchJobResult>;
  runLogRotation: () => Promise<BatchJobResult>;
  runTripleExtractionBatch: () => Promise<BatchJobResult>;
  runQualityMeasurementBatch: () => Promise<BatchJobResult>;
  runMetaMemoryIntrospection: () => Promise<BatchJobResult>;
  runMemoryReviewCandidatesJob: () => Promise<BatchJobResult>;
  runSleepConsolidationBatch: () => Promise<BatchJobResult>;
  runTelemetryCleanupBatch: () => Promise<void>;
}
```

`BatchScheduler.start`에서 `mementoConfig.consolidationScoreEnabled` 등 플래그를 읽어 컨텍스트를 채운다. `scheduleJob`·`addInterval`·`run*`는 `this`에 바인딩한 화살표/메서드로 전달한다.

- [ ] **Step 2:** 기존 `scheduleCoreMaintenanceJobs` ~ `scheduleAllRecurringJobs` 및 `scheduleConsolidationScoreFullSweep`, `scheduleWeeklyRelationValidation`, `scheduleTripleExtractionBatch`, `scheduleQualityMeasurement`, `scheduleSleepConsolidation`, `scheduleTelemetryCleanup` 본문을 `export function registerAllRecurringJobs(ctx: BatchRecurringRegistrationContext): void` 및 필요한 내부 `function scheduleCoreMaintenanceJobs(...)`로 옮긴다. **로직·주석·숫자 우선순위는 문자 단위로 동일해야 한다.**

- [ ] **Step 3:** `BatchScheduler.scheduleAllRecurringJobs`는 `registerAllRecurringJobs(this.buildRecurringContext())` 한 줄로 대체.

- [ ] **Step 4:** `restartJob`에 하드코딩된 `scheduleJob` 호출이 동일 클로저를 쓰도록, `batch-recurring-schedules.ts`에서 `export function scheduleCoreMaintenanceJobsOnly(ctx: Pick<...>)` 같은 **재사용 가능한 작은 export**를 두어 중복을 제거한다(이슈 완료 기준).

- [ ] **Step 5:** `npm test` 전체 코어 스케줄러 관련 + 커밋 `refactor(scheduler): extract recurring schedule registration`

---

### Task 8: 정리·전수 검증

**Files:** `batch-scheduler.ts` (불필요 import 제거), 전체 핸들러

- [ ] **Step 1:** `npm run lint` 및 `npm test` (루트 `npm test` 권장 — AGENTS.md 품질 게이트).

- [ ] **Step 2:** `batch-scheduler.ts` 줄 수가 설계 의도만큼 줄었는지 확인. 공개 export·`IBatchScheduler` 구현 시그니처 diff 없음 확인.

- [ ] **Step 3:** 최종 커밋 `refactor(scheduler): complete issue 224 batch scheduler split` (또는 Task 7에서 이미 완료 시 생략)

---

## Spec 대응표 (자체 리뷰)

| Spec 요구 | 이 계획 Task |
|-----------|-------------|
| `handlers/` + 도메인 묶음 | Task 2–6 파일 구성 |
| 반복 `schedule*` 전용 모듈 | Task 7 |
| 좁은 컨텍스트·역참조 금지 | Task 1 `RunContext`, 핸들러는 `batch-scheduler` 미import |
| 동작·에러·BatchJobResult 동일 | 각 Task: 복사-이동, 래핑 금지 원칙 |
| 테스트·lint | Task 0, 각 Task, Task 8 |
| 비범위 (스키마·Coordinator 대개편) | Task에서 건드리지 않음 |

**Placeholder 점검:** 본 문서에 TBD/TODO 없음. 구현 중 줄 번호는 리베이스 시 `rg`로 재확인한다.

---

**Plan complete.** 저장 경로: `docs/superpowers/plans/2026-05-10-issue-224-batch-scheduler-handlers-plan.md` (워크트리에 커밋 예정).

**실행 방식 선택:**

1. **Subagent-Driven (권장)** — Task마다 새 서브에이전트, 태스크 사이 리뷰, 빠른 반복  
2. **Inline Execution** — 이 세션에서 `executing-plans`로 체크포인트마다 일괄 진행  

원하는 번호를 알려 주세요.
