# 비동기 Augmentation 파이프라인 (Issue #89)

## 개요

대화/이벤트는 **지연 없이 즉시 저장**하고, Fact/Triple/요약/중복제거/콘솔리데이션은 **백그라운드 워커**에서 수행하는 파이프라인이다. Memori 레퍼런스의 “무지연” 설계를 반영한다.

## 즉시 저장

- **remember / remember_procedure** 호출 시:
  - 메모리 항목을 DB에 **append-only**로 저장한다.
  - 응답은 **저장 직후** 반환한다. Augmentation(Triple 추출, 콘솔리데이션 등) 완료를 기다리지 않는다.
- 구현: `packages/memento-core/src/domains/memory/tools/remember-tool.ts`, `remember-procedure-tool.ts`에서 DB write 성공 후 즉시 반환. Triple 추출 등은 `BatchScheduler.addJob()`으로 JobQueue에만 등록.

## 워커 정제

다음 작업은 **BatchScheduler**에서 배치/큐 기반으로 실행된다.

| 작업 | 트리거 | 역할 |
|------|--------|------|
| Per-item Triple 추출 | JobQueue (`addJob` from remember-tool) | episodic 저장 직후 작업 등록 |
| `triple_extraction` 배치 | 1시간 주기 | 미처리 episodic 배치 처리 (배치 크기 10) |
| `sleep_consolidation` | 1시간 주기 | 에피소드 → 시맨틱 증류 (`SleepConsolidationService`) |
| `consolidation_score_incremental` | 1시간 주기 | 통합 점수 증분 업데이트 |
| `consolidation_score_full_sweep` | 24시간 (새벽 3시) | 전체 통합 점수 재계산 |
| `relation_validation` | 7일 (일요일 새벽 2시) | 관계 그래프 유효성 검증 |
| `quality_measurement` | 24시간 | 메모리 품질 측정 |
| `forgetting_cleanup` | 24시간 | TTL 만료 기억 정리 |
| `memory_review_candidates` | 24시간 | 복습 후보 갱신 |

참고 파일:
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
- `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job.ts`
- `packages/memento-core/src/workers/consolidation-score-worker.ts`

## 실패 재시도·모니터링

- **재시도**
  - JobQueue에 등록된 작업(Per-item Triple 추출 등): `RetryManager`가 실패 시 재시도. 설정은 `BatchJobConfig.retryAttempts`, `retryDelay` 등.
  - Triple 추출 배치: `TripleExtractionBatchJob` 내부에서 실패 시 `memory_item.triple_extracted_status`를 `failed`로 업데이트하고, 메타데이터에 `retry_count`·`last_attempt` 기록. 주기 배치 또는 다음 배치에서 미처리 항목 재처리 가능.
- **모니터링**
  - BatchScheduler 로그(파일·콘솔), `getStatus()`로 큐 크기·실행 중 작업·마지막 실행 시각 확인.
  - HTTP 서버 사용 시 admin 라우트에서 스케줄러 상태·큐 조회 가능.

## 범위 참고

- **Fact 추출**: Issue #88에서 Fact 메타데이터 정규화. 대화에서 Fact를 “추출”하는 전용 단계는 별도 이슈에서 도입 가능.
- **요약**: 에피소드 요약이 별도 서비스로 있으면 동일하게 JobQueue/배치에 등록.
- **중복제거(dedupe)**: Issue #90 (Triple/KG dedupe) 및 기존 consolidation과 연동.
