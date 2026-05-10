# Issue #277 후속 구현 계획 (Review Queue Scaling)

- 기준 문서
  - `docs/_work/solutions/2026-05-05-issue-277-review-queue-scaling-spike.md`
  - `docs/adr/2026-05-05-issue-277-review-queue-scaling-strategy.md`
- 원칙
  - YAGNI: 기본안은 현행 유지(A), 트리거 충족 시에만 B/C 진행
  - Functional Core, Structured Shell 준수
  - 구현은 작은 이슈로 분할하여 검증 가능하게 진행

## 1. 목표

현재 SQLite + BatchScheduler 구조를 유지하면서, A -> B -> C 전환 판단을 가능하게 하는 운영 지표/경계면/실험 단위를 만든다.

## 2. 비목표

- 본 계획 자체에서 Redis/외부 scheduler를 즉시 도입하지 않는다.
- 대규모 스키마 개편이나 전면 교체를 한 번에 수행하지 않는다.

## 3. 단계별 실행 백로그

### Track A: 현행 유지 + 관측 강화 (필수 선행)

1) `memory_review_candidates` 실행 메타 표준화
- 산출물: 실행 시작/종료/지연/결과(성공, inserted, updated, error count) 이벤트 스키마
- 완료 조건: 운영 로그/진단에서 동일 키로 집계 가능
- 구현 참고 (Issue #293): `RuntimeDiagnosticsLogger` 경로(`app-events.jsonl`)에 `type: memory_review_candidates_run` 레코드가 기록된다. 고정 키는 `schema_version`, `job_name`, `started_at`, `finished_at`, `duration_ms`, `result`(`success`|`failure`), `inserted`, `updated`, `error_count`, `selected_count`, `first_error`이다. diagnostics가 비활성화된 프로세스에서는 동일 페이로드가 앱 로그 메시지 `memory_review_candidates_run`으로 출력된다.

2) pending 큐 건강도 지표 추가
- 산출물: pending 총량, 증가율, review/dismiss 처리량, 생성량 대비 처리량
- 완료 조건: 주기별 추이 확인 가능(대시보드 또는 집계 로그)
- 구현 상태(2026-05): `GET /admin/memory/review-candidates/metrics`(live 창별 집계 + 스냅샷 이력), `memory_review_queue_health_snapshot`(마이그레이션 034), 배치 `memory_review_candidates` 종료 시 스냅샷 append, 대시보드 Review Queue 패널에 건강 카드 표시 — [GitHub #294](https://github.com/jee1/memento/issues/294).

3) 수동 실행 관측성 보강
- 산출물: `/admin/batch/run` 실행 이력(잡 타입, 실행 시각, 결과) 추적 지점
- 완료 조건: 운영자가 단일 화면/로그 쿼리로 최근 수동 실행 이력 확인 가능

### Track B: 큐 전환 준비 (트리거 충족 시 착수)

4) 큐 경계 인터페이스 설계
- 산출물: producer/consumer 계약(메시지 스키마, 버전, idempotency key) — 문서: [`docs/_work/solutions/2026-05-09-review-queue-boundary-idempotency-contract.md`](../../_work/solutions/2026-05-09-review-queue-boundary-idempotency-contract.md)
- 완료 조건: 기존 코드와 병행 가능한 adapter 초안

5) 이벤트 fan-out PoC
- 산출물: review-candidates changed 이벤트를 in-process 외 경로로 전파하는 실험 — **HTTP 릴레이(`MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS`) + 계약 봉투 JSON** ([`docs/_work/solutions/2026-05-09-review-queue-changed-event-fan-out-poc.md`](../../_work/solutions/2026-05-09-review-queue-changed-event-fan-out-poc.md), GitHub #297)
- 완료 조건: 단일 노드/다중 노드 시나리오에서 이벤트 손실/지연 측정값 확보

6) 재시도/DLQ 정책 문서화
- 산출물: retry 횟수, backoff, DLQ 전환 기준, 수동 재처리 절차
- 완료 조건: 장애 대응 런북 포함
- 구현 상태(2026-05): [`docs/_work/solutions/2026-05-09-review-queue-retry-backoff-dlq-runbook.md`](../../_work/solutions/2026-05-09-review-queue-retry-backoff-dlq-runbook.md) — GitHub [#298](https://github.com/jee1/memento/issues/298)

### Track C: 멀티 인스턴스 정합성 강화 (필요 시)

7) 스케줄 단일 실행 전략 선택
- 산출물: leader election 또는 external trigger 비교 및 채택안 — [`docs/_work/solutions/2026-05-09-review-queue-schedule-single-runner-strategy.md`](../../_work/solutions/2026-05-09-review-queue-schedule-single-runner-strategy.md); 구현: `MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED` (기본 true), GitHub [#299](https://github.com/jee1/memento/issues/299)
- 완료 조건: 중복 실행 방지 검증 시나리오 통과

8) SSE 전략 재정의
- 산출물: ~~shared bus fan-out 또는 polling-only 단순화 ADR~~ → **계층 전략 문서 확정** ([#300](https://github.com/jee1/memento/issues/300)): [`docs/_work/solutions/2026-05-09-review-queue-sse-multi-instance-strategy.md`](../../_work/solutions/2026-05-09-review-queue-sse-multi-instance-strategy.md) 및 ADR 후속 항목 6
- 완료 조건: 멀티 인스턴스에서 **정합성 = 폴링**, SSE = 동일 인스턴스 힌트 + sticky 권장, 릴레이/버스는 게이트에 따른 Tier 2/3로 명시

## 4. 트리거 기반 게이트

- Gate A->B
  - 멀티 인스턴스 상시 운영 필요
  - 배치 지연/누적 반복
  - pending 증가 추세 고착
  - 인스턴스별 실행 경로 추적 비용 과다

- Gate B->C
  - B 도입 후에도 스케줄 책임 분리 요구 강함
  - 독립 scheduler/worker 운영 역량 확보
  - 중앙 감사/재실행 통제 요구 존재

## 5. 검증 전략

- 단위: 스키마/계약/정책 파서 및 idempotency 키 생성 규칙
- 통합: 배치 실행 -> 후보 갱신 -> 대시보드 반영 지연 측정
- 운영: 장애 주입(consumer down, retry 초과) 후 DLQ/복구 절차 검증

## 6. 권장 이슈 분해 (실행 순서)

1. 배치 실행 메타 이벤트 스키마 정의
2. pending 큐 건강도 지표/대시보드 추가
3. `/admin/batch/run` 실행 이력 가시화
4. 큐 경계 인터페이스(메시지 계약 + idempotency) 설계
5. changed 이벤트 fan-out PoC
6. retry/DLQ/런북 문서화
7. 스케줄 단일 실행 전략 선택 및 검증
8. 멀티 인스턴스 SSE 전략 문서 확정 ([#300](https://github.com/jee1/memento/issues/300) — `docs/_work/solutions/2026-05-09-review-queue-sse-multi-instance-strategy.md`)

## 7. 완료 정의

- 본 계획의 완료는 "모든 항목 구현"이 아니라,
  1) Gate 판단에 필요한 데이터가 수집 가능하고,
  2) A/B/C 전환 의사결정을 재현 가능한 기준으로 수행할 수 있으며,
  3) 후속 이슈가 독립적으로 실행 가능한 형태로 분해된 상태를 의미한다.
