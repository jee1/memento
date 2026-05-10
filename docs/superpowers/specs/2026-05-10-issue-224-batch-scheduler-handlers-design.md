# Issue #224 — `batch-scheduler.ts` 2차 분리 (handlers + 반복 스케줄 등록)

## 배경·목표

- [#174](https://github.com/jee1/memento/issues/174) 1단계에서 `BatchJobExecutionCoordinator`, 타입·검증·DB 통계 등이 분리된 뒤에도 `batch-scheduler.ts`가 대형(약 1700+ 줄)으로 남아 God object 완화 2차가 필요하다.
- **`scheduler/jobs/`**는 기존처럼 **상태·수명이 있는 배치 클래스**(`TripleExtractionBatchJob` 등)만 둔다.
- **`run*` 배치 실행 본문**과 **반복 `schedule*` 묶음**은 **`scheduler/handlers/`** 및 선택적 **`scheduler/batch-recurring-schedules.ts`**(이름은 구현 시 기존 네이밍과 충돌 없게 조정)로 옮겨, `BatchScheduler`는 오케스트레이션·공개 API·DI 연결에 집중한다.
- **공개 API**(`BatchScheduler`, `createBatchScheduler`, `getBatchScheduler`, `IBatchScheduler` 계약)와 **런타임 동작·테스트 회귀**는 유지한다.

## 접근 비교 (요약)

| 안 | 내용 | 장점 | 단점 |
|----|------|------|------|
| **A** | `handlers/`에 작업별로 얇게 파일 다수(거의 1 run ≈ 1 파일) | 충돌 적음, 변경 범위·원인 추적이 단순 | 파일 수 증가, import 다발 |
| **B (채택)** | `handlers/`에 **도메인 묶음**으로 소수 파일 + **반복 스케줄 등록**은 전용 모듈 1개 | 이슈 범위와 맞고, 기존 `scheduleCoreMaintenanceJobs` 등 **응집된 묶음**과 정렬 | 파일당 줄 수 관리 필요 |
| **C** | `run*`만 분리하고 `schedule*`는 클래스에 유지 | 초기 이동 최소 | 스케줄 반복이 클래스에 남아 개선 효과 제한 |

**채택: B.** 이슈 본문의 “배치 실행 로직 파일 단위 분리 + 스케줄 래퍼 모음”과 일치한다.

## 아키텍처

### 디렉터리·모듈

- `packages/memento-core/src/infrastructure/scheduler/handlers/`
  - **`batch-scheduler-run-context.ts`** (가칭): 핸들러가 필요로 하는 **좁은 컨텍스트** 타입. `BatchScheduler`의 private 필드 전체를 노출하지 않고, `forgettingService`, `performanceMonitor`, `jobExecutionCoordinator`, `db`, `config` 일부, 기존 `jobs/*` 참조, 로깅·진단 훅 등 **실제로 run 본문이 읽는 것만** 명시한다.
  - 도메인 묶음 파일(가칭, 구현 시 실제 `run*` 목록에 맞게 조정):
    - **유지보수·코어**: `runMemoryCleanup`, `runMonitoring`, `runHealthCheck`
    - **리뷰·메타**: `runMemoryReviewCandidatesJob`, `runMetaMemoryIntrospection`
    - **콘솔리데이션·점수·관계·로그**: consolidation score incremental/full sweep, `runWeeklyRelationValidation`, `runLogRotation`
    - **증강·품질·트리플**: `runTripleExtractionBatch`, `runQualityMeasurementBatch` (필요 시 기존 `jobs/*` 위임 로직은 그대로 두고 호출만 핸들러로 이동)
    - **슬립·텔레메트리**: `runSleepConsolidationBatch`, `runTelemetryCleanupBatch`
- **`batch-recurring-schedules.ts`** (가칭): `scheduleCoreMaintenanceJobs`, `scheduleConsolidationRelationAndLogJobs`, `scheduleAugmentationAndTelemetryJobs`, `scheduleMetaMemoryAndReviewJobs`, `scheduleAllRecurringJobs`, 개별 `scheduleTripleExtractionBatch` 등 **setInterval 등록 전용** 로직. `BatchScheduler`는 `scheduleJob` 등 **등록 API**를 컨텍스트 또는 콜백으로 넘긴다.

### `BatchScheduler` 역할

- 생성자·`start`/`stop`/`runJob`·`updateConfig`·큐/코디네이터 연결 등 **기존 공개·핵심 라이프사이클** 유지.
- 기존 `private async runX` 본문은 **핸들러 모듈의 함수**로 이동하고, 클래스 쪽에는 **한 줄 위임** 또는 **컨텍스트 빌드 후 호출**만 남긴다(초기 PR에서는 위임 레이어가 두껍게 남아 있어도 됨—동작 동일 우선).
- `schedule*` 묶음은 **반복 등록 모듈**로 이동; `BatchScheduler`는 `registerAllRecurring(this 또는 adapter)` 한두 호출로 정리.

### 의존성·순환 참조

- 핸들러는 `@memento/core` 내부 도메인·기존 `jobs/*`·`batch-scheduler-internal-helpers` 등을 **현재와 동일한 방향**으로만 import한다.
- `handlers` → `BatchScheduler` **역참조 금지**. 컨텍스트는 `BatchScheduler`가 조립해 전달한다.

## 데이터 흐름

- **수동/단발 실행**: `runJob(name)` → (기존과 같이) 이름에 매핑된 실행 경로 → **핸들러 함수** 또는 기존 `BatchJobExecutionCoordinator` 경로. 분기 테이블만 스케줄러 파일에 남기거나, 매핑을 작은 `batch-job-name-registry`로 옮기는 것은 **선택**(YAGNI: 회귀 최소화 위해 2차 후반에만 검토).
- **주기 실행**: `start` → `registerAllRecurring` → `scheduleJob` → 클로저에서 **동일 핸들러 함수** 호출. 기존 interval 이름·우선순위·중복 등록 방지 규칙 유지.

## 에러 처리·관측

- 재시도·타임아웃·`BatchJobResult` 형식은 **변경하지 않는다**. 로깅·진단 이벤트 키도 동일하게 유지한다.
- 핸들러로 옮기면서 `try/catch` 경계가 바뀌지 않도록, 기존 블록을 **그대로 옮기고** 래핑만 추가하지 않는다.

## 테스트·완료 기준

- 루트에서 `npm test`, `npm run lint` 통과(워크스페이스 규칙 준수).
- `packages/memento-core/.../scheduler/__tests__/batch-scheduler.spec.ts` 및 관련 스펙 **회귀 없음**. 핸들러에서 순수 로직이 분리되면 **해당 모듈 단위 테스트**를 소량 추가할 수 있으나 필수는 아님.
- (선택) 이슈에 명시된 slop-detector 등 정적 분석에서 해당 경로 복잡도 개선이 있으면 보너스.

## 비범위

- 스키마·배치 주기 기본값·비즈니스 규칙 변경.
- `BatchJobExecutionCoordinator` 내부 대규모 리팩터.
- 공개 export 경로 추가·Breaking change.

## 관련 이슈

- Parent / context: [#174](https://github.com/jee1/memento/issues/174)
- 본 작업: [#224](https://github.com/jee1/memento/issues/224)
