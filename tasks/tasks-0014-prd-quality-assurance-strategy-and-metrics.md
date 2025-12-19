# tasks-0014-prd-quality-assurance-strategy-and-metrics.md

## Relevant Files

- `src/infrastructure/database/database/migration/migrations/XXX-quality-assurance-schema.ts` - 품질 측정을 위한 데이터베이스 스키마 마이그레이션 (quality_measurement_history, quality_metrics, quality_thresholds 테이블 생성)
- `src/services/quality-assurance/quality-assurance-service.ts` - 중앙 품질 관리 서비스 (Orchestrator)
- `src/services/quality-assurance/quality-metrics-collector.ts` - Collector: 품질 지표 수집
- `src/services/quality-assurance/quality-evaluator.ts` - Evaluator: 임계값 비교 및 품질 평가
- `src/services/quality-assurance/quality-recorder.ts` - Recorder: 측정 결과를 기억으로 저장
- `src/services/quality-assurance/quality-reporter.ts` - Reporter: 회상용 리포트 생성
- `src/services/quality-assurance/quality-threshold-manager.ts` - 품질 임계값 관리자
- `src/services/quality-assurance/quality-assurance-service.spec.ts` - QualityAssuranceService 단위 테스트
- `src/services/quality-assurance/quality-metrics-collector.spec.ts` - QualityMetricsCollector 단위 테스트
- `src/services/quality-assurance/quality-evaluator.spec.ts` - QualityEvaluator 단위 테스트
- `src/services/quality-assurance/quality-recorder.spec.ts` - QualityRecorder 단위 테스트
- `src/services/quality-assurance/quality-reporter.spec.ts` - QualityReporter 단위 테스트
- `src/services/quality-assurance/quality-threshold-manager.spec.ts` - QualityThresholdManager 단위 테스트
- `src/server/routes/quality.routes.ts` - HTTP API 라우터 (품질 리포트, 이력, 임계값 조회/업데이트)
- `src/server/routes/quality.routes.spec.ts` - Quality 라우터 단위 테스트
- `scripts/quality-report.ts` - CLI 명령어 스크립트 (품질 리포트 생성)
- `scripts/quality-thresholds.ts` - CLI 명령어 스크립트 (품질 임계값 관리)
- `src/infrastructure/scheduler/jobs/quality-measurement-batch-job.ts` - 배치 작업: 품질 측정 작업
- `src/infrastructure/scheduler/jobs/quality-measurement-batch-job.spec.ts` - QualityMeasurementBatchJob 단위 테스트
- `src/infrastructure/scheduler/batch-scheduler.ts` - BatchScheduler에 품질 측정 작업 통합 (수정)
- `src/test/test-quality-assurance.ts` - 품질 보장 시스템 E2E 테스트

### Notes

- 기존 품질 검증 시스템들을 통합합니다:
  - `RelationQualityValidator` (`src/domains/relation/services/relation-quality-validator.ts`)
  - `VectorSearchQualityMetrics` (`src/test/helpers/vector-search-quality-metrics.ts`)
  - `ConsolidationScoreQualityTests` (관련 테스트 파일들)
- 데이터베이스 마이그레이션은 기존 마이그레이션 시스템을 따릅니다 (`src/infrastructure/database/database/migration/`).
- HTTP API 라우터는 기존 라우터 구조를 따릅니다 (`src/server/routes/api.routes.ts` 참고).
- CLI 명령어는 `package.json`의 scripts에 추가됩니다.
- 배치 작업은 `BatchScheduler`에 통합됩니다 (`src/infrastructure/scheduler/batch-scheduler.ts`).
- 테스트는 Vitest를 사용하며, `npm test`로 실행합니다.

## Tasks

- [x] 1.0 데이터베이스 스키마 및 마이그레이션 구현
  - [x] 1.1 마이그레이션 버전 번호 확인 및 결정 (기존 마이그레이션 버전 확인 후 다음 버전 할당)
  - [x] 1.2 `src/infrastructure/database/database/migration/migrations/009-quality-assurance-schema.sql` 파일 생성 (quality_measurement_history, quality_metrics, quality_thresholds 테이블 및 인덱스 정의)
  - [x] 1.3 `src/infrastructure/database/database/migration/migrations/009-quality-assurance-schema.ts` 마이그레이션 클래스 구현 (Migration 인터페이스 구현, up/down/validateBefore/validateAfter 메서드)
  - [x] 1.4 마이그레이션 단위 테스트 작성 (`009-quality-assurance-schema.spec.ts`)
  - [x] 1.5 마이그레이션 실행 및 검증 (테스트 데이터베이스에서 마이그레이션 실행 후 스키마 검증)

- [ ] 2.0 통합 품질 관리 서비스 구현
  - [x] 2.1 `src/services/quality-assurance/quality-threshold-manager.ts` 구현 (임계값 CRUD, 기본 임계값 초기화)
  - [x] 2.2 `src/services/quality-assurance/quality-threshold-manager.spec.ts` 단위 테스트 작성
  - [x] 2.3 `src/services/quality-assurance/quality-metrics-collector.ts` 구현 (품질 지표 수집 인터페이스 및 기본 구조, namespace 단위 수집 메서드 제공: collectSearchMetrics, collectRelationMetrics, collectConsolidationMetrics 등)
  - [x] 2.4 `src/services/quality-assurance/quality-metrics-collector.spec.ts` 단위 테스트 작성
  - [x] 2.5 `src/services/quality-assurance/quality-evaluator.ts` 구현 (임계값 비교, 품질 평가, 상태 결정: pass/warning/fail)
  - [x] 2.6 `src/services/quality-assurance/quality-evaluator.spec.ts` 단위 테스트 작성
  - [x] 2.7 `src/services/quality-assurance/quality-recorder.ts` 구현 (측정 결과를 quality_measurement_history 및 quality_metrics 테이블에 저장)
  - [x] 2.8 `src/services/quality-assurance/quality-recorder.spec.ts` 단위 테스트 작성
  - [x] 2.9 `src/services/quality-assurance/quality-reporter.ts` 구현 (Markdown, JSON, HTML 형식 리포트 생성)
  - [x] 2.10 `src/services/quality-assurance/quality-reporter.spec.ts` 단위 테스트 작성
  - [x] 2.11 `src/services/quality-assurance/quality-assurance-service.ts` 구현 (Orchestrator: Collector, Evaluator, Recorder, Reporter 통합)
  - [x] 2.12 `src/services/quality-assurance/quality-assurance-service.spec.ts` 단위 테스트 작성

- [x] 3.0 기존 품질 검증 시스템 통합
  - [x] 3.1 검색 품질 지표 수집기 구현 (`QualityMetricsCollector`에 검색 품질 수집 메서드 추가: Precision@K, Recall@K, NDCG@K, MRR, Kendall's Tau)
  - [x] 3.2 `src/test/helpers/vector-search-quality-metrics.ts`의 기존 함수들을 활용하여 검색 품질 측정 로직 통합
  - [x] 3.3 검색 품질 수집기 단위 테스트 작성
  - [x] 3.4 관계 추출 품질 지표 수집기 구현 (`QualityMetricsCollector`에 관계 추출 품질 수집 메서드 추가: Precision, Recall, F1-Score, 관계 유형별 정확도)
  - [x] 3.5 `src/domains/relation/services/relation-quality-validator.ts`를 활용하여 관계 추출 품질 측정 로직 통합
  - [x] 3.6 관계 추출 품질 수집기 단위 테스트 작성
  - [x] 3.7 Consolidation 점수 품질 지표 수집기 구현 (`QualityMetricsCollector`에 Consolidation 점수 안정성 수집 메서드 추가: 점수 분포, 순서 보존 검증)
  - [x] 3.8 Consolidation 점수 품질 수집기 단위 테스트 작성
  - [x] 3.9 기본 저장 품질 지표 수집기 구현 (중복 비율, 데이터 무결성, 스키마 준수율, 데이터 손실률)
  - [x] 3.10 기본 저장 품질 수집기 단위 테스트 작성
  - [x] 3.11 `QualityAssuranceService`에 모든 수집기를 통합하고 통합 테스트 작성

- [ ] 4.0 품질 저하 감지 및 임계값 관리 구현
  - [x] 4.1 기본 품질 임계값 초기화 로직 구현 (`QualityThresholdManager`에 기본 임계값 설정: 검색, 관계 추출, Consolidation 점수별, 보수적 초기값 설정 원칙 적용 - 예: Precision@5 ≥ 0.7, F1 ≥ 0.6, 중복률 ≤ 5%)
  - [x] 4.2 품질 저하 감지 로직 구현 (`QualityEvaluator`에 임계값 미달 시 경고 생성 로직)
  - [x] 4.3 경고 로그 기록 로직 구현 (품질 저하 발생 시 구조화된 JSON 로그 기록, `logs/quality-warnings-{date}.log`)
  - [x] 4.4 품질 저하 이력 추적 구현 (`quality_measurement_history` 테이블에 status='warning' 또는 'error' 기록)
  - [x] 4.5 품질 저하 감지 단위 테스트 작성 (임계값 미달 시나리오 테스트)
  - [x] 4.6 CLI 명령어로 임계값 조회/업데이트 기능 구현 (`scripts/quality-thresholds.ts` 기본 구조)
  - [x] 4.7 HTTP API로 임계값 조회/업데이트 기능 구현 (`src/server/routes/quality.routes.ts`에 임계값 엔드포인트 추가)

  - [x] 5.0 리포트 생성 및 배치 작업 통합
  - [x] 5.1 CLI 명령어 스크립트 구현 (`scripts/quality-report.ts`: --format, --namespace, --from, --to 옵션 지원)
  - [x] 5.2 `package.json`에 `quality:report` 및 `quality:thresholds` 스크립트 추가
  - [x] 5.3 HTTP API 라우터 구현 (`src/server/routes/quality.routes.ts`: GET /api/v1/quality/report, GET /api/v1/quality/history, GET /api/v1/quality/thresholds, PUT /api/v1/quality/thresholds/{namespace}/{key}`)
  - [x] 5.4 HTTP API 라우터 단위 테스트 작성 (`src/server/routes/quality.routes.spec.ts`)
  - [x] 5.5 로그 파일 생성 로직 구현 (`QualityReporter`에 JSON 형식 로그 파일 저장 기능: `logs/quality-report-{timestamp}.json`)
  - [x] 5.6 `src/infrastructure/scheduler/jobs/quality-measurement-batch-job.ts` 배치 작업 구현 (일일 품질 측정 작업)
  - [x] 5.7 `src/infrastructure/scheduler/jobs/quality-measurement-batch-job.spec.ts` 배치 작업 단위 테스트 작성
  - [x] 5.8 `BatchScheduler`에 품질 측정 배치 작업 통합 (`BatchJobConfig`에 qualityMeasurementInterval 추가, 스케줄러에 작업 등록)
  - [x] 5.9 CI/CD 통합을 위한 품질 측정 테스트 훅 구현 (테스트 실행 시 자동 품질 측정, warning 시 빌드 성공+로그 기록, fail 시 빌드 실패)
  - [x] 5.10 품질 보장 시스템 E2E 테스트 작성 (`src/test/test-quality-assurance.ts`: 전체 플로우 테스트)

