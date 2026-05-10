# 리뷰 후보 배치 스케줄 단일 실행 전략 (GitHub #299, #277 Track C 선행 결정)

## 문제

- `memory_review_candidates` 는 **프로세스별** `BatchScheduler` 인터벌로 등록된다.
- **단일 프로세스** 안에서는 동일 잡 이름이 이미 실행 중이면 큐에 넣고 이후에만 재실행한다 (`BatchJobExecutionCoordinator.executeJobWithRetry` + `JobQueue.isRunning`).
- **여러 HTTP admin 인스턴스**가 같은 DB를 두고 띄우면, 인스턴스마다 인터벌이 돌아 **주기 실행이 N배**가 될 수 있다 (경합·불필요 부하·이벤트 중복의 원인).

## 후보 비교

| 전략 | 장점 | 단점 | 현재 코드베이스 적합성 |
|------|------|------|------------------------|
| **A. 외부 트리거 단일 실행자** | 구현 단순, 운영·감사 경로 명확(YAGNI), 장애 시 누가 돌렸는지 추적 쉬움 | 크론/별도 orchestrator·용도별 인스턴스 구분 등 운영 규율 필요 | **채택(기본)** — SQLite 단일 파일 + in-process 스케줄러 철학과 맞음 |
| **B. 리더 선출(분산 락)** | 자동 페일오버·복제본 동일 설정 가능 | SQLite만으로는 리더십/TTL/펜스 토큰 설계 부담, Redis 등 B 단계와 자연스럽게 묶임 | **예비(B/C)** — Gate B 이후(외부 큐·락 스토어)에서 재평가 |
| **C. 스케줄러 전부 끄고 worker 전용** | 책임 분리 극대화 | 운영·배포 단위 증가 | ADR #277 Track C, 별도 이슈 |

## 채택안 (2026-05)

1. **기본 운영:** 리뷰 후보 배치의 **주기 실행은 정확히 한 실행자만** 갖도록 한다.
   - 권장: **한 인스턴스**에만 `BatchScheduler` 기동(다른 인스턴스는 `BATCH_SCHEDULER_ENABLED=false`) **또는**, 모든 인스턴스에서 스케줄러는 켜되 아래 플래그로 **해당 잡 인터벌만 끈다**.
2. **외부 트리거:** 단일 실행자 인스턴스에 대해 `POST /admin/batch/run` `{ "jobType": "memory_review_candidates" }` 또는 동등한 `runJob`을 크론/GitHub Actions 등에서 호출해 주기를 대체할 수 있다.
3. **향후:** 멀티 인스턴스가 상시이고 자동 리더 교체가 필요하면 **B 전략**(Redis/DB 리스 임대 등)을 별도 설계로 도입한다.

## 구현 (코드)

- 환경 변수 **`MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED`** (기본 `true`):
  - `false`이면 `memory_review_candidates` **인터벌 등록 생략**.
  - **수동** `runJob('memory_review_candidates')` / HTTP 배치 실행은 그대로 동작.
- `restartJob('memory_review_candidates')` 는 플래그가 꺼져 있으면 `false`를 반환하고 경고 로그만 남긴다.

## 검증 시나리오 (중복 실행 방지 관점)

1. **단일 프로세스:** 동일 잡 연속 트리거 시 한 번에 하나만 실행(기존 JobQueue 동작).
2. **스케줄 비활성:** `memoryReviewCandidatesSchedulerEnabled=false`로 시작 시 `getStatus().activeJobs`에 `memory_review_candidates` 없음, `runJob`은 성공.
3. **멀티 인스턴스(운영):** N−1 인스턴스에서 플래그 `false` 또는 스케줄러 비활성 + 1 인스턴스(또는 크론)만 주기 실행 — 설계상 단일 주기원.

## 참고

- 상위 계획: `docs/superpowers/plans/2026-05-05-issue-277-review-queue-scaling-followup-plan.md` Track C 항목 7.
- ADR: `docs/adr/2026-05-05-issue-277-review-queue-scaling-strategy.md` (후속 작업 5).
