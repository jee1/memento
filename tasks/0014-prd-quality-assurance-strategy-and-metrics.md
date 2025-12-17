# 0014-prd-quality-assurance-strategy-and-metrics.md

## Introduction/Overview

이 PRD는 Memento MCP 서버의 **Memory Quality Assurance (메모리 품질 보장)** 시스템을 구현하는 것을 목표로 합니다. 현재 Memento에는 여러 품질 검증 시스템(RelationQualityValidator, Vector Search Quality Verification, Consolidation Score Quality Tests 등)이 개별적으로 존재하지만, 이를 통합하고 체계화하는 중앙 품질 관리 시스템이 부재합니다.

현재 시스템은 각 기능별로 품질을 측정하고 있으나, 전체적인 품질 보장 전략이 없어 다음과 같은 문제가 발생합니다:

* 품질 측정이 산발적이고 일관성이 없음
* 품질 저하를 조기에 감지하기 어려움
* 품질 지표가 통합적으로 관리되지 않음
* 품질 리포트가 체계적으로 생성되지 않음
* 품질 임계값이 명확하게 정의되지 않음

이 기능이 도입되면 다음과 같은 문제가 해결됩니다:

* **Memory Quality** 영역(검색, 관계 추출, Consolidation 점수)에 대한 통합 품질 관리
* 배치 및 테스트 시 자동 품질 측정
* 품질 저하 시 자동 감지 및 경고 로그 기록
* CLI, HTTP API, 로그 파일을 통한 품질 리포트 제공
* 명확하게 정의된 품질 지표 및 임계값

**Memento 정체성과의 정렬:**

본 기능은 Memento가 저장한 기억의 품질을 스스로 점검하고, 장기적으로 신뢰 가능한 기억 체계를 유지하기 위한 **Meta-Quality Memory Layer**를 제공합니다. 이는 단순한 QA 시스템이 아니라, Memento가 **자기 기억의 상태를 인식하는 능력**을 갖게 하는 핵심 인프라입니다.

**범위 명확화:**

이 PRD는 **Memory Quality Assurance**에 집중하며, 시스템 관측성(Observability) 지표(CPU, TPS, 응답 시간 등)는 향후 확장을 위한 hook만 제공하고 Phase 1 구현에서는 제외합니다.

## Goals

### Phase 1: Memory Quality Assurance (본 PRD 범위)

1. **통합 품질 관리 시스템 구축**: 기존 품질 검증 시스템들을 통합하는 중앙 품질 관리 시스템 구현
2. **Memory Quality 지표 정의**: 검색 품질, 관계 추출 품질, Consolidation 점수 안정성에 대한 정량적 지표 정의
3. **자동 품질 측정**: 배치 작업 및 CI/CD 테스트 시 자동으로 품질을 측정하는 메커니즘 구현
4. **품질 저하 감지**: 품질이 임계값 이하로 떨어질 때 자동 감지 및 경고 로그 기록
5. **품질 리포트 생성**: CLI 명령어, HTTP API, 로그 파일을 통한 품질 리포트 제공
6. **품질 임계값 관리**: 각 품질 지표별 임계값 정의 및 관리 시스템 구축

### Phase 2: 확장 기능 (향후)

7. **시스템 관측성 지표**: 성능(응답 시간, TPS), 안정성(에러율, 가용성) 지표 (hook만 제공, 구현 보류)
8. **테스트 커버리지 지표**: 코드 커버리지, 테스트 통과율 (향후 확장)
9. **정성적 지표**: 사용자 만족도, 주관적 평가 (향후 확장)

## User Stories

### AI 에이전트 관점

- **US-001**: AI 에이전트로서 기억을 저장하고 검색할 때 품질이 일정 수준 이상 유지되기를 원한다
- **US-002**: AI 에이전트로서 품질 저하가 발생했을 때 이를 조기에 감지하고 싶다

### 개발자 관점

- **US-003**: 개발자로서 모든 핵심 품질 지표를 한 곳에서 확인하고 싶다
- **US-004**: 개발자로서 배치 작업을 통해 정기적으로 품질을 측정하고 싶다
- **US-005**: 개발자로서 CI/CD 파이프라인에서 자동으로 품질을 검증하고 싶다
- **US-006**: 개발자로서 품질 저하가 발생했을 때 경고 로그를 통해 즉시 알림을 받고 싶다
- **US-007**: 개발자로서 CLI 명령어로 품질 리포트를 생성하고 싶다
- **US-008**: 개발자로서 HTTP API를 통해 품질 리포트를 조회하고 싶다
- **US-009**: 개발자로서 품질 리포트를 로그 파일로 저장하고 싶다

### 시스템 관리자 관점

- **US-010**: 시스템 관리자로서 시스템 전반의 품질 상태를 모니터링하고 싶다
- **US-011**: 시스템 관리자로서 품질 임계값을 설정하고 관리하고 싶다

## Functional Requirements

### FR-1: 통합 품질 관리 시스템

- **FR-1.1**: 중앙 품질 관리 서비스(`QualityAssuranceService`)를 구현해야 함
  - 기존 품질 검증 시스템들을 통합하는 인터페이스 제공
  - RelationQualityValidator, Vector Search Quality, Consolidation Score Quality 등 통합
  - 역할 분리:
    * **Collector**: 품질 지표 수집 (기존 검증 시스템 호출)
    * **Evaluator**: 임계값 비교 및 품질 평가
    * **Recorder**: 측정 결과를 기억으로 저장 (Meta-Quality Memory)
    * **Reporter**: 회상용 리포트 생성
- **FR-1.2**: 품질 측정 결과를 저장하는 데이터베이스 스키마를 정의해야 함
  - 품질 측정 이력 테이블 (`quality_measurement_history`)
  - 품질 지표 테이블 (`quality_metrics`)
  - 품질 임계값 테이블 (`quality_thresholds`)
- **FR-1.3**: 품질 측정 결과를 캐싱하여 성능을 최적화해야 함

### FR-2: 품질 지표 정의

#### FR-2.1: 검색 품질 지표
- **FR-2.1.1**: 검색 정확도 지표를 정의해야 함
  - Precision@K (K=5, 10)
  - Recall@K (K=5, 10)
  - NDCG@K (K=5, 10)
  - MRR (Mean Reciprocal Rank)
- **FR-2.1.2**: 검색 랭킹 품질 지표를 정의해야 함
  - Kendall's Tau 순서 일치도
  - 상위 K개 결과 유지율
- **FR-2.1.3**: 검색 관련성 지표를 정의해야 함
  - 벡터 유사도 분포
  - Consolidation 점수 분포


#### FR-2.3: 임베딩 품질 지표 (Phase 1 선택적, Phase 2 확장)
- **FR-2.3.1**: 임베딩 정확도 지표를 정의해야 함 (Phase 1 선택적)
  - 벡터 유사도 정확도
  - 임베딩 차원 일관성
  - 참고: 임베딩 품질은 검색 품질에 간접 반영되므로, Phase 1에서는 선택적으로 구현
- **FR-2.3.2**: 임베딩 성능 지표를 정의해야 함 (Phase 2)
  - 임베딩 생성 시간
  - 임베딩 제공자별 성능 비교

#### FR-2.4: 관계 추출 품질 지표
- **FR-2.4.1**: 관계 추출 정확도 지표를 정의해야 함
  - Precision, Recall, F1-Score (기존 RelationQualityValidator 활용)
  - 관계 유형별 정확도
  - 신뢰도 범위 준수율
- **FR-2.4.2**: 관계 추출 완전성 지표를 정의해야 함
  - 누락된 관계 비율
  - 잘못 추출된 관계 비율

#### FR-2.5: 기억 저장 품질 지표 (Phase 1 기본, Phase 2 확장)
- **FR-2.5.1**: 데이터 무결성 지표를 정의해야 함 (Phase 1)
  - 중복 기억 비율
  - 데이터 손실률
  - 스키마 준수율
- **FR-2.5.2**: 압축 효율 지표를 정의해야 함 (Phase 2)
  - 압축률
  - 압축 후 데이터 손실률

**참고**: 시스템 전반 품질 지표(성능, 안정성, 테스트 커버리지) 및 정성적 지표는 Phase 2에서 구현하며, Phase 1에서는 hook만 제공합니다.

### FR-3: 자동 품질 측정

- **FR-3.1**: 배치 작업을 통해 주기적으로 품질을 측정해야 함
  - 일일 배치 작업으로 품질 측정
  - 측정 결과를 데이터베이스에 저장
- **FR-3.2**: CI/CD 파이프라인에서 테스트 시 품질을 측정해야 함
  - 테스트 실행 시 자동으로 품질 측정
  - 품질 저하 시 빌드 실패 또는 경고
- **FR-3.3**: 품질 측정 결과를 로그 파일에 기록해야 함

### FR-4: 품질 저하 감지

- **FR-4.1**: 품질 임계값을 정의하고 관리할 수 있어야 함
  - 각 품질 지표별 임계값 설정
  - 임계값을 데이터베이스에 저장
- **FR-4.2**: 품질 측정 시 임계값을 검증해야 함
  - 측정 결과가 임계값 이하일 때 경고 로그 기록
  - 경고 로그에 상세 정보 포함 (지표명, 측정값, 임계값, 차이)
- **FR-4.3**: 품질 저하 이력을 추적해야 함
  - 품질 저하 발생 시 이력 기록
  - 품질 저하 패턴 분석을 위한 데이터 수집

### FR-5: 품질 리포트 생성

#### FR-5.1: CLI 명령어
- **FR-5.1.1**: CLI 명령어로 품질 리포트를 생성할 수 있어야 함
  - `npm run quality:report` 명령어 제공
  - 리포트 형식: Markdown, JSON, HTML (선택 가능)
- **FR-5.1.2**: CLI 명령어로 특정 품질 지표만 조회할 수 있어야 함
  - `npm run quality:report -- --namespace=search` 옵션 제공
- **FR-5.1.3**: CLI 명령어로 특정 기간의 품질 이력을 조회할 수 있어야 함
  - `npm run quality:report -- --from=2025-01-01 --to=2025-01-31` 옵션 제공

#### FR-5.2: HTTP API
- **FR-5.2.1**: HTTP API 엔드포인트로 품질 리포트를 조회할 수 있어야 함
  - `GET /api/v1/quality/report` 엔드포인트 제공
  - 응답 형식: JSON
- **FR-5.2.2**: HTTP API 엔드포인트로 특정 품질 지표만 조회할 수 있어야 함
  - `GET /api/v1/quality/report?namespace=search` 쿼리 파라미터 지원
- **FR-5.2.3**: HTTP API 엔드포인트로 품질 이력을 조회할 수 있어야 함
  - `GET /api/v1/quality/history?from=2025-01-01&to=2025-01-31` 엔드포인트 제공

#### FR-5.3: 로그 파일
- **FR-5.3.1**: 품질 리포트를 로그 파일로 저장해야 함
  - 로그 파일 경로: `logs/quality-report-{timestamp}.json`
  - 로그 파일 형식: JSON
- **FR-5.3.2**: 품질 저하 경고를 로그 파일에 기록해야 함
  - 로그 파일 경로: `logs/quality-warnings-{date}.log`
  - 로그 형식: 구조화된 JSON 로그

### FR-6: 품질 임계값 관리

- **FR-6.1**: 품질 임계값을 설정할 수 있어야 함
  - 각 품질 지표별 임계값 설정
  - 임계값을 데이터베이스에 저장
- **FR-6.2**: 품질 임계값을 조회할 수 있어야 함
  - CLI 명령어: `npm run quality:thresholds`
  - HTTP API: `GET /api/v1/quality/thresholds`
- **FR-6.3**: 품질 임계값을 업데이트할 수 있어야 함
  - CLI 명령어: `npm run quality:thresholds:update -- --namespace=search --key=precision_at_5 --threshold=0.8`
  - HTTP API: `PUT /api/v1/quality/thresholds/{namespace}/{key}`

### FR-7: 기존 품질 검증 시스템 통합

- **FR-7.1**: RelationQualityValidator를 통합해야 함
  - 관계 추출 품질 측정 시 RelationQualityValidator 활용
  - 측정 결과를 중앙 품질 관리 시스템에 저장
- **FR-7.2**: Vector Search Quality Verification을 통합해야 함
  - 벡터 검색 품질 측정 시 기존 검증 시스템 활용
  - 측정 결과를 중앙 품질 관리 시스템에 저장
- **FR-7.3**: Consolidation Score Quality Tests를 통합해야 함
  - Consolidation 점수 품질 측정 시 기존 테스트 활용
  - 측정 결과를 중앙 품질 관리 시스템에 저장

## Implementation Phases

### Phase 1: Memory Quality Assurance (본 PRD 범위)

**핵심 목표**: Memento 정체성에 직결되는 Memory Quality만 1차로 구현

**포함 범위:**
- 검색 품질 (search): Precision@K, Recall@K, NDCG@K, MRR, Kendall's Tau
- 관계 추출 품질 (relation): Precision, Recall, F1-Score, 관계 유형별 정확도
- Consolidation 점수 안정성: Consolidation 점수 분포, 순서 보존 검증
- 기본 저장 품질: 중복 비율, 데이터 무결성
- 임베딩 품질: 선택적 (검색 품질에 간접 반영되므로, Phase 1에서는 선택적 구현)

**제외 범위:**
- 시스템 관측성 지표 (성능, 안정성): hook만 제공, 구현 보류
- 테스트 커버리지 지표: Phase 2
- 정성적 지표: Phase 2
- 압축 효율 지표: Phase 2

### Phase 2: 확장 기능 (향후)

- 시스템 관측성 지표 (성능, 안정성, 리소스 사용량)
- 테스트 커버리지 지표
- 정성적 지표 (사용자 만족도)
- 압축 효율 지표
- 실시간 품질 모니터링 대시보드 UI (선택적)

## Non-Goals (Out of Scope)

1. **실시간 품질 모니터링 대시보드 UI**: 이 기능은 실시간 대시보드 UI를 제공하지 않습니다. CLI, HTTP API, 로그 파일을 통한 리포트만 제공합니다. (Phase 2에서 검토)
2. **자동 품질 개선 기능**: 이 기능은 품질을 측정하고 감지하는 것에 집중하며, 자동으로 품질을 개선하는 기능은 포함하지 않습니다.
3. **시스템 관측성 (Observability)**: Phase 1에서는 Memory Quality에 집중하며, 시스템 관측성 지표는 hook만 제공하고 구현은 보류합니다.

## Design Considerations

### 데이터베이스 스키마

```sql
-- 품질 측정 이력 테이블
CREATE TABLE quality_measurement_history (
  id TEXT PRIMARY KEY,
  measurement_type TEXT NOT NULL, -- 'batch', 'test', 'manual'
  measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metrics JSON NOT NULL, -- 품질 지표 데이터 (JSON 형식)
  -- metrics JSON 구조:
  -- {
  --   "metric_namespace": "search",
  --   "metric_key": "precision_at_5",
  --   "context": "default",
  --   "value": 0.85,
  --   "threshold_value": 0.8,
  --   "evaluator_version": "1.0.0"
  -- }
  status TEXT CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
  warnings JSON, -- 경고 정보 (임계값 미달 시)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 품질 지표 테이블 (최신 측정값)
CREATE TABLE quality_metrics (
  metric_namespace TEXT NOT NULL, -- 'search', 'relation', 'consolidation'
  metric_key TEXT NOT NULL, -- 'precision_at_5', 'f1_score' 등
  context TEXT DEFAULT 'default', -- 'default', 'ci', 'nightly'
  metric_value REAL NOT NULL,
  measured_at TIMESTAMP NOT NULL,
  status TEXT CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
  threshold_value REAL, -- 임계값
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

-- 품질 임계값 테이블
CREATE TABLE quality_thresholds (
  metric_namespace TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  context TEXT DEFAULT 'default',
  threshold_value REAL NOT NULL,
  threshold_type TEXT CHECK (threshold_type IN ('min', 'max')) NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

-- 인덱스
CREATE INDEX idx_quality_measurement_history_measured_at ON quality_measurement_history(measured_at);
CREATE INDEX idx_quality_measurement_history_type ON quality_measurement_history(measurement_type);
CREATE INDEX idx_quality_metrics_namespace_key ON quality_metrics(metric_namespace, metric_key);
CREATE INDEX idx_quality_metrics_context ON quality_metrics(context);
CREATE INDEX idx_quality_thresholds_namespace_key ON quality_thresholds(metric_namespace, metric_key);
```

### 서비스 구조

```
src/services/quality-assurance/
  ├── quality-assurance-service.ts      # 중앙 품질 관리 서비스 (Orchestrator)
  ├── quality-metrics-collector.ts      # Collector: 품질 지표 수집
  ├── quality-evaluator.ts              # Evaluator: 임계값 비교 및 평가
  ├── quality-recorder.ts               # Recorder: 측정 결과를 기억으로 저장
  ├── quality-reporter.ts               # Reporter: 회상용 리포트 생성
  └── quality-threshold-manager.ts      # 품질 임계값 관리자
```

### CLI 명령어

```bash
# 품질 리포트 생성
npm run quality:report
npm run quality:report -- --format=json
npm run quality:report -- --namespace=search
npm run quality:report -- --from=2025-01-01 --to=2025-01-31

# 품질 임계값 관리
npm run quality:thresholds
npm run quality:thresholds:update -- --namespace=search --key=precision_at_5 --threshold=0.8
```

### HTTP API 엔드포인트

```
GET  /api/v1/quality/report          # 품질 리포트 조회
GET  /api/v1/quality/history         # 품질 이력 조회
GET  /api/v1/quality/thresholds      # 품질 임계값 조회
PUT  /api/v1/quality/thresholds/{namespace}/{key}  # 품질 임계값 업데이트
```

## Technical Considerations

### 의존성

- 기존 품질 검증 시스템 활용:
  - `RelationQualityValidator` (관계 추출 품질)
  - `VectorSearchQualityMetrics` (벡터 검색 품질)
  - `ConsolidationScoreQualityTests` (Consolidation 점수 품질)
- 데이터베이스: SQLite (기존 스키마 확장)
- 배치 스케줄러: 기존 `BatchScheduler` 활용

### 성능 고려사항

- 품질 측정은 배치 작업으로 실행하여 메인 플로우에 영향 없도록 함
- 품질 측정 결과는 캐싱하여 반복 조회 시 성능 최적화
- 대량 데이터 처리 시 배치 크기 조정 필요

### 에러 처리

- 품질 측정 실패 시에도 시스템이 정상 동작하도록 graceful degradation
- 품질 측정 실패 시 명확한 에러 로그 기록
- 품질 리포트 생성 실패 시 기본 리포트 제공

### 마이그레이션 전략

- 기존 데이터 손실 없이 스키마 확장
- 점진적 롤아웃 가능 (기능 비활성 상태로 배포 후 활성화)
- 롤백 계획 수립 (필요 시 필드 제거 마이그레이션)

## Success Metrics

### 기능적 기준

1. **Phase 1 핵심 품질 지표 정의 및 측정 가능**
   - 검색 품질 지표: Precision@5, Recall@5, NDCG@5, MRR, Kendall's Tau 측정 가능
   - 관계 추출 품질 지표: Precision, Recall, F1-Score, 관계 유형별 정확도 측정 가능
   - Consolidation 점수 안정성: 순서 보존 검증, 품질 저하율 측정 가능
   - 기본 저장 품질 지표: 중복 비율, 데이터 무결성 측정 가능

2. **품질 저하 시 자동 감지 및 알림**
   - 품질이 임계값 이하로 떨어질 때 자동 감지
   - 경고 로그 자동 기록
   - 경고 로그에 상세 정보 포함 (지표명, 측정값, 임계값, 차이)

3. **품질 리포트 정기 생성**
   - 배치 작업으로 일일 품질 리포트 생성
   - CI/CD 파이프라인에서 테스트 시 품질 리포트 생성
   - CLI, HTTP API, 로그 파일을 통한 리포트 제공

### 성능 기준

1. **품질 측정 성능**
   - 배치 작업 실행 시간 < 5분 (일반적인 데이터 크기)
   - 품질 리포트 생성 시간 < 10초

2. **품질 리포트 조회 성능**
   - CLI 명령어 실행 시간 < 2초
   - HTTP API 응답 시간 < 1초 (p95)

### 정확도 기준

1. **품질 지표 계산 정확도**
   - 기존 품질 검증 시스템의 계산 결과와 일치
   - 정량적 지표는 소수점 4자리까지 정확

2. **품질 저하 감지 정확도**
   - 임계값 미달 시 100% 감지
   - 오탐지율 < 1%

### 사용성 기준

1. **품질 리포트 가독성**
   - 리포트가 명확하고 이해하기 쉬움
   - Markdown 형식 리포트가 잘 포맷됨
   - JSON 형식 리포트가 구조화됨

2. **CLI 명령어 사용성**
   - 명령어가 직관적이고 사용하기 쉬움
   - 에러 메시지가 명확함
   - 도움말이 충분함

## Issue 분해 제안

이 PRD는 **Epic PRD**이며, 구현 시 다음과 같이 이슈를 분해하는 것을 권장합니다:

1. **Issue A**: QualityAssuranceService + 데이터베이스 스키마 + 기본 Collector/Evaluator/Recorder 구현
2. **Issue B**: Search / Relation 품질 통합 (기존 검증 시스템 연동)
3. **Issue C**: Consolidation 점수 품질 통합
4. **Issue D**: Threshold + Degradation Detection 구현
5. **Issue E (후순위)**: Reporter (CLI/API) 구현

**권장 구현 순서**: A → B → C → D → E

이 순서는 기반 인프라 구축 → 핵심 품질 영역 통합 → 안정성 검증 → 저하 감지 → 리포트 제공 순으로 진행하여, 각 단계에서 검증 가능한 결과를 얻을 수 있습니다.

## Open Questions

1. **품질 측정 주기**: 배치 작업의 실행 주기를 어떻게 설정할까요? (일일, 주간, 월간)
2. **품질 임계값 초기값**: 각 품질 지표별 임계값의 초기값을 어떻게 설정할까요? (기존 데이터 기반 통계적 분석 필요)
3. **품질 리포트 보관 기간**: 품질 측정 이력을 얼마나 오래 보관할까요? (데이터베이스 크기 고려)
4. **품질 저하 알림 방식**: 경고 로그 외에 추가 알림 방식이 필요할까요? (이메일, 슬랙 등 - Phase 2에서 검토)
5. **시스템 관측성 hook 설계**: Phase 2를 위한 hook 인터페이스를 어떻게 설계할까요?

