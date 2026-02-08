# 비동기 Augmentation 파이프라인 (Issue #89)

## 개요

대화/이벤트는 **지연 없이 즉시 저장**하고, Fact/Triple/요약/중복제거/콘솔리데이션은 **백그라운드 워커**에서 수행하는 파이프라인이다. Memori 레퍼런스의 “무지연” 설계를 반영한다.

## 즉시 저장

- **remember / remember_procedure** 호출 시:
  - 메모리 항목을 DB에 **append-only**로 저장한다.
  - 응답은 **저장 직후** 반환한다. Augmentation(Triple 추출, 콘솔리데이션 등) 완료를 기다리지 않는다.
- 구현: `src/domains/memory/tools/remember-tool.ts`, `remember-procedure-tool.ts`에서 DB write 성공 후 즉시 반환. Triple 추출 등은 `BatchScheduler.addJob()`으로 JobQueue에만 등록.

## 워커 정제

다음 작업은 **BatchScheduler**에서 배치/큐 기반으로 실행된다.

| 작업 | 구현 위치 | 비고 |
|------|-----------|------|
| Per-item Triple 추출 | JobQueue (`addJob` from remember-tool) | episodic 저장 시 작업 등록 |
| Triple 추출 배치 | `TripleExtractionBatchJob` | 미처리 episodic 배치 처리 |
| 콘솔리데이션 점수 | `ConsolidationScoreWorker` | 증분/전체 스윕 |
| 관계 검증 | `RelationValidatorExecutor` | 주간 검증 |
| 품질 측정 | `QualityMeasurementBatchJob` | 일일 배치 |
| 메모리 정리(TTL 등) | `ForgettingPolicyService` | cleanup 배치 |

참고 파일:
- `src/infrastructure/scheduler/batch-scheduler.ts`
- `src/infrastructure/scheduler/jobs/triple-extraction-batch-job.ts`
- `src/workers/consolidation-score-worker.ts`

## 실패 재시도·모니터링

- **재시도**: JobQueue + `RetryManager` (`BatchJobConfig.retryAttempts`, `retryDelay`). Triple 추출 배치 실패 시 `TripleExtractionBatchJob` 내부에서 상태(`triple_extracted_status`) 업데이트 및 재시도 정책 적용.
- **모니터링**: BatchScheduler 로그, `getStatus()`, admin 라우트에서 큐/실행 상태 확인 가능.

## 범위 참고

- **Fact 추출**: Issue #88에서 Fact 메타데이터 정규화. 대화에서 Fact를 “추출”하는 전용 단계는 별도 이슈에서 도입 가능.
- **요약**: 에피소드 요약이 별도 서비스로 있으면 동일하게 JobQueue/배치에 등록.
- **중복제거(dedupe)**: Issue #90 (Triple/KG dedupe) 및 기존 consolidation과 연동.
