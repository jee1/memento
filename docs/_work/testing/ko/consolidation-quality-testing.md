# Consolidation Score 검색 품질 테스트 가이드

이 문서는 Consolidation Score가 벡터 검색 결과에 올바르게 반영되는지 검증하고, 다양한 시나리오에서 검색 품질을 측정 및 튜닝하는 방법을 설명합니다.

## 목차

1. [개요](#개요)
2. [환경 설정](#환경-설정)
3. [Seed 데이터 주입](#seed-데이터-주입)
4. [Consolidation 점수 필드 초기화](#consolidation-점수-필드-초기화)
5. [기능 플래그 설정](#기능-플래그-설정)
6. [테스트 실행](#테스트-실행)
7. [Baseline 스냅샷 관리](#baseline-스냅샷-관리)
8. [실행 시간 가이드](#실행-시간-가이드)
9. [Seed 데이터 규모 및 생성 방법](#seed-데이터-규모-및-생성-방법)
10. [Fallback 처리](#fallback-처리)
11. [벡터 검색 품질 검증](#벡터-검색-품질-검증)

## 개요

Consolidation Score는 `Final_Score = w1 * vector_similarity + w2 * consolidation_score` 공식으로 최종 검색 점수에 반영됩니다. 이 테스트는 다음을 검증합니다:

- Consolidation 점수가 검색 결과에 올바르게 반영되는지
- 다양한 가중치 조합에서 검색 품질이 개선되는지
- 랭킹 순서가 정확한지
- 기능 플래그 on/off 시나리오에서 정상 동작하는지

## 환경 설정

### 필수 환경 변수

`.env` 파일에 다음 환경 변수를 설정하세요:

```bash
# Consolidation Score System 활성화
CONSOLIDATION_SCORE_ENABLED=true

# 데이터베이스 경로
DB_PATH=./data/memory.db
```

### 선택적 환경 변수

```bash
# Seed 데이터 파일 경로 (기본값: ./data/consolidation-seed.json)
CONSOLIDATION_TEST_SEED_PATH=./data/consolidation-seed.json

# Baseline 스냅샷 저장 경로 (기본값: ./data/consolidation-baseline.json)
CONSOLIDATION_BASELINE_PATH=./data/consolidation-baseline.json

# 벤치마크 테스트 데이터 크기 (기본값: 100)
CONSOLIDATION_TEST_ITEM_COUNT=100
```

## Seed 데이터 주입

### 자동 생성

테스트 헬퍼(`src/test/helpers/consolidation-test-data.ts`)를 사용하면 자동으로 샘플 데이터를 생성할 수 있습니다:

```typescript
import { seedTestDatabase } from './helpers/consolidation-test-data.js';

const { memoryIds, items } = seedTestDatabase(db, 100, true);
// 100개의 메모리 아이템과 임베딩 생성
```

### 수동 생성

수동으로 메모리 아이템을 생성하려면:

```typescript
import { insertMemoryItem, insertMemoryEmbedding } from './helpers/consolidation-test-data.js';

const item = {
  id: 'mem_1',
  type: 'episodic',
  content: 'Test content',
  importance: 0.8,
  tags: ['test'],
  recall_count: 5,
  consolidation_score: 0.7,
  g_value: 2.5
};

insertMemoryItem(db, item);
insertMemoryEmbedding(db, {
  memory_id: 'mem_1',
  embedding: [0.1, 0.2, ...], // 1536차원 벡터
  embedding_provider: 'tfidf'
});
```

## Consolidation 점수 필드 초기화

### 데이터베이스 스키마

Consolidation Score 필드는 다음 마이그레이션을 통해 추가됩니다:

- `recall_count`: INTEGER NOT NULL DEFAULT 0
- `last_accessed_at`: TIMESTAMP
- `consolidation_score`: REAL
- `g_value`: REAL

### 초기화 방법

1. **새 메모리 생성 시**: `remember` 도구를 사용하면 자동으로 초기화됩니다 (기능 플래그 활성화 시).

2. **기존 데이터 마이그레이션**: Consolidation Score Worker를 실행하여 기존 데이터의 점수를 계산합니다:

```bash
npm run test:batch-scheduler
```

3. **테스트 데이터 초기화**: 테스트 헬퍼를 사용하면 자동으로 초기화됩니다:

```typescript
import { generateSampleMemoryItems } from './helpers/consolidation-test-data.js';

const items = generateSampleMemoryItems(100);
// 각 아이템에 consolidation_score, recall_count, g_value가 자동 설정됨
```

## 기능 플래그 설정

### 활성화

```bash
CONSOLIDATION_SCORE_ENABLED=true
```

또는 코드에서:

```typescript
import { mementoConfig } from './config/index.js';

mementoConfig.consolidationScoreEnabled = true;
```

### 비활성화

```bash
CONSOLIDATION_SCORE_ENABLED=false
```

기능 플래그가 비활성화되면:
- Consolidation Score 계산이 수행되지 않습니다
- 검색 결과에 `consolidation_score` 필드가 포함되지 않습니다
- 기존 점수 계산 방식만 사용됩니다

## 테스트 실행

### 단위 테스트

```bash
# SearchRanking 단위 테스트
npm test src/algorithms/search-ranking.spec.ts

# SearchResultCombiner 단위 테스트
npm test src/algorithms/search-result-combiner-consolidation.spec.ts
```

### 통합 테스트

```bash
# HybridSearchEngine 통합 테스트
npm test src/algorithms/hybrid-search-engine-consolidation.spec.ts
```

### E2E 품질 검증 테스트

```bash
npm run test:consolidation-quality
```

이 테스트는:
- 실제 데이터로 검색 품질을 측정합니다
- Consolidation 점수 반영 전/후를 비교합니다
- 다양한 검색 쿼리 시나리오를 테스트합니다
- 랭킹 순서 정확성을 검증합니다

### 벤치마크 테스트

```bash
npm run benchmark:consolidation-quality
```

이 벤치마크는:
- 다양한 가중치 조합에서 품질을 비교합니다
- Consolidation 점수 영향력을 분석합니다
- 튜닝 가이드라인을 제공합니다
- Baseline 스냅샷을 저장합니다

## Baseline 스냅샷 관리

### 저장

벤치마크 실행 시 자동으로 Baseline 스냅샷이 저장됩니다:

```bash
CONSOLIDATION_BASELINE_PATH=./data/consolidation-baseline.json npm run benchmark:consolidation-quality
```

### 비교

벤치마크 실행 시 자동으로 이전 Baseline과 비교합니다:

```
📈 Baseline과 비교:
  Baseline 버전: 1.0.0
  Baseline 생성 시간: 2025-01-15T10:30:00.000Z
  Baseline 최고 NDCG@5: 0.823
  현재 최고 NDCG@5: 0.856
  개선도: +0.033
  ✅ 품질이 개선되었습니다!
```

### 업데이트 절차

1. **언제 갱신 가능한지**:
   - 알고리즘 개선 후
   - 가중치 튜닝 후
   - 새로운 검색 프로파일 추가 후
   - 주요 기능 변경 후

2. **PR 검증 방식**:
   - Baseline과 비교하여 품질이 개선되었는지 확인
   - 품질이 저하된 경우 PR 설명에 이유 명시
   - Baseline 업데이트는 별도 커밋으로 관리

3. **버전 관리**:
   - Baseline 스냅샷은 JSON 형식으로 저장
   - 버전 필드를 통해 추적 가능
   - Git에 커밋하여 버전 관리

## 실행 시간 가이드

### E2E 테스트

- **예상 소요 시간**: 5-10초
- **데이터 크기**: 20개 메모리 아이템 (기본값)
- **실행 옵션**: 단일 스레드 실행 (기본)

### 벤치마크 테스트

- **예상 소요 시간**: 30-60초 (데이터 크기에 따라 다름)
- **데이터 크기**: 100개 메모리 아이템 (기본값)
- **실행 옵션**:
  - `--runInBand`: 순차 실행 (안정적, 느림)
  - `--maxConcurrency=4`: 병렬 실행 (빠름, 리소스 사용)

```bash
# 순차 실행 (권장)
npm run benchmark:consolidation-quality

# 병렬 실행 (빠름, 리소스 많이 사용)
CONSOLIDATION_TEST_ITEM_COUNT=500 npm run benchmark:consolidation-quality
```

### 성능 최적화

- 데이터 크기를 줄이면 실행 시간이 단축됩니다
- `CONSOLIDATION_TEST_ITEM_COUNT` 환경 변수로 조절 가능
- 벤치마크는 장기적으로 비교하기 위해 실행 시간과 데이터 크기를 로그로 기록합니다

## Seed 데이터 규모 및 생성 방법

### 권장 크기

- **E2E 테스트**: 20-50개 메모리 아이템
- **벤치마크 테스트**: 100-1000개 메모리 아이템
- **대규모 테스트**: 1000개 이상 (선택적)

### 생성 방법

1. **자동 생성** (권장):

```typescript
import { seedTestDatabase } from './helpers/consolidation-test-data.js';

// 100개 아이템 생성 (임베딩 포함)
const { memoryIds, items } = seedTestDatabase(db, 100, true);
```

2. **수동 생성**:

```typescript
import { generateSampleMemoryItems, generateSampleEmbeddings } from './helpers/consolidation-test-data.js';

const items = generateSampleMemoryItems(100);
const embeddings = generateSampleEmbeddings(items.map(i => i.id));
```

### 예상 실행 시간

| 데이터 크기 | E2E 테스트 | 벤치마크 테스트 |
|------------|-----------|----------------|
| 20 items   | 5-10초    | -              |
| 100 items  | 10-20초   | 30-60초        |
| 500 items  | 30-60초   | 2-5분          |
| 1000 items | 1-2분     | 5-10분         |

## Fallback 처리

### Seed 데이터 파일이 없을 때

`CONSOLIDATION_TEST_SEED_PATH`에 지정된 파일이 없으면:

1. **자동 생성**: 테스트 헬퍼가 자동으로 샘플 데이터를 생성합니다
2. **예외 처리**: 파일이 필수인 경우 예외를 발생시킵니다

```typescript
// 자동 생성 (기본 동작)
const { memoryIds, items } = seedTestDatabase(db, 100);

// 파일에서 로드 시도 (파일이 없으면 자동 생성)
try {
  const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  // seedData 사용
} catch (error) {
  // 파일이 없으면 자동 생성
  const { memoryIds, items } = seedTestDatabase(db, 100);
}
```

### Baseline 스냅샷이 없을 때

`CONSOLIDATION_BASELINE_PATH`에 지정된 파일이 없으면:

1. **첫 실행으로 간주**: Baseline이 없다는 경고 메시지 출력
2. **새 Baseline 생성**: 현재 결과를 Baseline으로 저장
3. **비교 생략**: 이전 Baseline과의 비교는 수행하지 않음

```typescript
const baseline = loadBaselineSnapshot(baselinePath);
if (!baseline) {
  console.log('⚠️  Baseline 스냅샷이 없습니다. 새로 생성합니다.');
  // 현재 결과를 Baseline으로 저장
  saveBaselineSnapshot(results, baselinePath);
}
```

## 품질 지표 설명

### Precision@K

상위 K개 결과 중 관련 결과 비율:

```
Precision@K = (상위 K개 중 관련 결과 수) / K
```

### Recall@K

관련 결과 중 상위 K개에 포함된 비율:

```
Recall@K = (상위 K개에 포함된 관련 결과 수) / (전체 관련 결과 수)
```

### NDCG@K

정규화된 할인 누적 이득:

```
NDCG@K = DCG@K / IDCG@K
```

- DCG: 실제 랭킹의 할인 누적 이득
- IDCG: 이상적인 랭킹의 할인 누적 이득

## 튜닝 가이드라인

벤치마크 결과를 바탕으로:

1. **최적 가중치 조합 제안**: 가장 높은 NDCG@5를 가진 가중치 조합
2. **검색 프로파일별 권장 설정**: recent, balanced, memory 프로파일별 최적 설정
3. **Consolidation 점수 영향력 분석**: Consolidation 사용 시 품질 개선 정도
4. **Baseline과 비교**: 이전 결과 대비 품질 개선 여부

## 문제 해결

### 테스트 실패 시

1. **데이터베이스 초기화 확인**: `initializeTestDatabase()`가 올바르게 실행되었는지 확인
2. **기능 플래그 확인**: `CONSOLIDATION_SCORE_ENABLED`가 올바르게 설정되었는지 확인
3. **의존성 확인**: 필요한 서비스(EmbeddingService, VectorSearchEngine)가 초기화되었는지 확인

### 벤치마크가 느릴 때

1. **데이터 크기 줄이기**: `CONSOLIDATION_TEST_ITEM_COUNT` 환경 변수 조정
2. **병렬 실행**: `--maxConcurrency` 옵션 사용 (주의: 리소스 사용 증가)
3. **임베딩 생성 비활성화**: `seedTestDatabase(db, count, false)` - 임베딩 없이 테스트

## 벡터 검색 품질 검증

벡터 검색 품질 검증 시스템은 Consolidation Score가 벡터 검색 품질을 저하시키지 않는지 검증합니다. 이 시스템은 순서 보존, 품질 지표 비교, 극단적 시나리오 검증을 통해 검색 품질을 종합적으로 평가합니다.

### 개요

벡터 검색 품질 검증은 다음을 검증합니다:

- **순서 보존**: Consolidation Score 반영 전/후 검색 결과의 순서가 유지되는지
- **품질 지표**: Precision, Recall, NDCG 지표가 저하되지 않는지
- **극단적 시나리오**: 저벡터 유사도 + 고 consolidation, 고벡터 유사도 + 저 consolidation 등 극단적 조합에서도 정상 동작하는지
- **Baseline 비교**: 이전 Baseline 대비 품질이 저하되지 않는지

### 테스트 실행

#### 통합 테스트

```bash
# 벡터 검색 품질 검증 통합 테스트
npm test src/test/test-vector-search-quality-with-consolidation.spec.ts
```

이 테스트는 다음을 검증합니다:

1. **테스트 데이터 준비 (시드 기반 재현성)**
   - 시드 기반 데이터 생성으로 동일 입력 시 동일 결과 보장
   - 다양한 시나리오 샘플 데이터 구성 (벡터 유사도 높음/낮음, Consolidation 높음/낮음, 극단적 조합)

2. **Ground Truth 생성 및 로드**
   - 시드 기반 자동 Ground Truth 생성
   - JSON 파일로 저장/로드 지원
   - 다양한 선택 전략 지원 (`random`, `first`, `pattern`)

3. **순서 보존 검증**
   - Kendall's Tau ≥ 0.7
   - Top10 유지율 ≥ 80%
   - Top5 유지율 ≥ 90%

4. **품질 지표 비교**
   - NDCG@5 저하율 < 5%
   - Precision@5 저하율 < 10%
   - Recall@5 저하율 < 10%

5. **극단적 시나리오 검증**
   - 저벡터 유사도 + 고 consolidation 점수 검증
   - 고벡터 유사도 + 저 consolidation 점수 검증
   - w2 상한 검증 (w2=0.4 vs w2=0.6)

6. **Baseline 스냅샷 저장 및 비교**
   - Baseline 스냅샷 저장/로드
   - 현재 결과와 Baseline 비교
   - 품질 저하 감지 및 경고

7. **리포트 생성 및 파일 저장**
   - JSON 및 Markdown 형식 리포트 저장
   - 통합 리포트 생성

8. **품질 저하 감지 시 경고 메시지 출력**
   - 콘솔 출력 (심각도별 다른 스트림 사용)
   - 파일 저장 지원

### 순서 보존 검증

순서 보존 검증은 Consolidation Score 반영 전/후 검색 결과의 순서가 얼마나 유지되는지 측정합니다.

#### 지표

- **Kendall's Tau**: 두 순서 간의 순위 상관관계 (-1 ~ 1)
  - 1: 완전히 일치
  - 0: 무관
  - -1: 완전히 반대
  - **Acceptance Criteria**: ≥ 0.7

- **Top-K Retention**: 상위 K개 결과 중 유지된 비율
  - **Top10 유지율**: ≥ 80%
  - **Top5 유지율**: ≥ 90%

#### 사용 예시

```typescript
import {
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
  generateOrderPreservationReport
} from './helpers/vector-search-quality-metrics.js';

// 검색 결과 생성
const vectorOnlyResults = generateVectorOnlySearchResults(searchResults.items, 20);
const consolidationResults = generateConsolidationSearchResults(searchResults.items, 20);

// 순서 보존 리포트 생성
const report = generateOrderPreservationReport({
  vectorOnly: vectorOnlyResults,
  withConsolidation: consolidationResults
});

// 검증 통과 여부 확인
if (report.passed) {
  console.log('✅ 순서 보존 검증 통과');
} else {
  console.error('❌ 순서 보존 검증 실패:', report.failureReasons);
}
```

### 품질 지표 비교

품질 지표 비교는 Ground Truth를 기반으로 Precision, Recall, NDCG 지표를 측정하고 Consolidation Score 반영 전/후를 비교합니다.

#### 지표

- **Precision@K**: 상위 K개 결과 중 관련 결과 비율
- **Recall@K**: 관련 결과 중 상위 K개에 포함된 비율
- **NDCG@K**: 정규화된 할인 누적 이득

#### Acceptance Criteria

- **NDCG@5 저하율**: < 5%
- **Precision@5 저하율**: < 10%
- **Recall@5 저하율**: < 10%

#### 사용 예시

```typescript
import {
  compareQualityWithGroundTruth,
  generateQualityComparisonReport
} from './helpers/vector-search-quality-metrics.js';

// Ground Truth 생성
const groundTruths = generateGroundTruth(memoryIds, {
  seed: 12345,
  queries: ['test-query'],
  relevantCountPerQuery: 5
});

const groundTruth = groundTruths[0];

// 품질 비교
const comparison = compareQualityWithGroundTruth(
  vectorOnlyResults,
  consolidationResults,
  groundTruth,
  [5, 10]
);

// 리포트 생성
const report = generateQualityComparisonReport(comparison, groundTruth);

// 검증 통과 여부 확인
if (report.summary.passed) {
  console.log('✅ 품질 지표 비교 통과');
} else {
  console.error('❌ 품질 지표 비교 실패:', report.thresholdValidation.failureReasons);
}
```

### 극단적 시나리오 검증

극단적 시나리오 검증은 벡터 유사도와 Consolidation Score의 극단적 조합에서도 검색 품질이 유지되는지 검증합니다.

#### 검증 시나리오

1. **저벡터 유사도 + 고 consolidation 점수**
   - 벡터 유사도는 낮지만 consolidation 점수가 높은 경우
   - 최종 점수가 적절한 범위 내에 있는지 검증

2. **고벡터 유사도 + 저 consolidation 점수**
   - 벡터 유사도는 높지만 consolidation 점수가 낮은 경우
   - 최종 점수가 적절한 범위 내에 있는지 검증

3. **w2 상한 검증**
   - w2=0.4 vs w2=0.6 비교
   - w2 상한이 품질에 미치는 영향 검증

#### 사용 예시

```typescript
import {
  validateLowVectorHighConsolidation,
  validateHighVectorLowConsolidation,
  validateW2UpperBound,
  generateExtremeScenarioReport
} from './helpers/vector-search-quality-metrics.js';

// 극단적 시나리오 검증
const lowVectorHigh = validateLowVectorHighConsolidation(hybridResults);
const highVectorLow = validateHighVectorLowConsolidation(hybridResults);
const w2Validation = validateW2UpperBound(hybridResults, groundTruth, [5]);

// 리포트 생성
const report = generateExtremeScenarioReport(
  lowVectorHigh,
  highVectorLow,
  w2Validation
);

// 검증 통과 여부 확인
if (report.overallPassed) {
  console.log('✅ 극단적 시나리오 검증 통과');
} else {
  console.error('❌ 극단적 시나리오 검증 실패:', report.summary.failedScenarios);
}
```

### Baseline 스냅샷 관리

Baseline 스냅샷은 이전 검증 결과를 저장하여 현재 결과와 비교할 수 있게 합니다.

#### 저장

```typescript
import { saveBaselineSnapshot } from './helpers/vector-search-quality-metrics.js';

const snapshot: BaselineSnapshot = {
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  testConfiguration: {
    dataSize: 100,
    weights: {
      vectorSimilarity: 0.6,
      consolidationScore: 0.4
    }
  },
  metrics: {
    orderPreservation: {
      kendallTau: 0.85,
      top10Retention: 0.9,
      top5Retention: 0.95
    },
    quality: {
      precision: { 5: 0.8, 10: 0.75 },
      recall: { 5: 0.7, 10: 0.65 },
      ndcg: { 5: 0.85, 10: 0.8 }
    },
    extremeScenarios: {
      lowVectorHighConsolidation: 1,
      highVectorLowConsolidation: 1
    }
  }
};

saveBaselineSnapshot(snapshot);
```

#### 비교 및 품질 저하 감지

```typescript
import {
  compareWithBaseline,
  detectQualityDegradation,
  printQualityAlert
} from './helpers/vector-search-quality-metrics.js';

// Baseline 로드
const baseline = loadBaselineSnapshot();

// 현재 결과와 비교
const comparison = compareWithBaseline(baseline, currentMetrics);

// 품질 저하 감지
const detection = detectQualityDegradation(comparison);

// 경고 메시지 출력
if (detection.detected) {
  printQualityAlert(detection, { output: 'console' });
}
```

### 리포트 생성 및 저장

검증 결과를 JSON 및 Markdown 형식으로 저장할 수 있습니다.

#### 리포트 타입

1. **순서 보존 리포트**: `saveOrderPreservationReport`
2. **품질 비교 리포트**: `saveQualityComparisonReport`
3. **극단적 시나리오 리포트**: `saveExtremeScenarioReport`
4. **통합 리포트**: `saveIntegratedReport`

#### 사용 예시

```typescript
import {
  saveOrderPreservationReport,
  saveQualityComparisonReport,
  saveExtremeScenarioReport,
  saveIntegratedReport
} from './helpers/vector-search-quality-metrics.js';

// 개별 리포트 저장
saveOrderPreservationReport(orderReport, { format: 'both' });
saveQualityComparisonReport(qualityReport, { format: 'markdown' });
saveExtremeScenarioReport(extremeReport, { format: 'json' });

// 통합 리포트 저장
saveIntegratedReport({
  orderReport,
  qualityReport,
  extremeReport,
  baselineComparison,
  qualityDegradation
}, { format: 'both' });
```

### 품질 저하 경고 메시지

품질 저하가 감지되면 자동으로 경고 메시지를 출력합니다.

#### 출력 형식

- **심각도별 레이블**: 🚨 CRITICAL, ⚠️ WARNING, ℹ️ INFO
- **Baseline 정보**: 버전, 생성 시간
- **감지된 품질 저하**: 메시지 목록
- **권장 조치 사항**: 개선 방안
- **상세 정보**: 순서 보존 지표, 품질 지표 변화

#### 출력 대상

- **콘솔**: `console.error` (critical), `console.warn` (warning), `console.log` (info)
- **파일**: 텍스트 파일로 저장

#### 사용 예시

```typescript
import {
  detectAndAlertQualityDegradation,
  printQualityAlert
} from './helpers/vector-search-quality-metrics.js';

// 통합 함수 사용 (감지 + 출력)
const detection = detectAndAlertQualityDegradation(
  comparison,
  {}, // 감지 옵션
  { output: 'console' } // 출력 옵션
);

// 또는 개별 함수 사용
const detection = detectQualityDegradation(comparison);
printQualityAlert(detection, {
  output: 'both',
  filePath: './data/quality-alert.txt'
});
```

### 테스트 데이터 준비

시드 기반 데이터 생성으로 재현 가능한 테스트를 수행할 수 있습니다.

```typescript
import {
  generateScenarioBasedTestData,
  generateSeededEmbeddings
} from './helpers/consolidation-test-data.js';

// 시드 기반 테스트 데이터 생성
const items = generateScenarioBasedTestData(100, 12345);
const embeddings = generateSeededEmbeddings(
  items.map(i => i.id),
  1536,
  12345
);
```

### Ground Truth 생성

Ground Truth는 검색 쿼리에 대한 관련 문서 목록을 자동으로 생성합니다.

```typescript
import {
  generateGroundTruth,
  saveGroundTruth,
  loadGroundTruth,
  generateOrLoadGroundTruth
} from './helpers/vector-search-quality-metrics.js';

// Ground Truth 생성
const groundTruths = generateGroundTruth(memoryIds, {
  seed: 12345,
  queries: ['query1', 'query2'],
  relevantCountPerQuery: 5,
  strategy: 'random' // 'random' | 'first' | 'pattern'
});

// 저장 및 로드
saveGroundTruth(groundTruths);
const loaded = loadGroundTruth();

// 또는 파일이 있으면 로드, 없으면 생성
const gt = generateOrLoadGroundTruth(memoryIds, {
  seed: 12345,
  queries: ['query1']
});
```

### Acceptance Criteria 요약

| 검증 항목 | 지표 | 임계값 |
|----------|------|--------|
| 순서 보존 | Kendall's Tau | ≥ 0.7 |
| 순서 보존 | Top10 유지율 | ≥ 80% |
| 순서 보존 | Top5 유지율 | ≥ 90% |
| 품질 지표 | NDCG@5 저하율 | < 5% |
| 품질 지표 | Precision@5 저하율 | < 10% |
| 품질 지표 | Recall@5 저하율 | < 10% |

### 문제 해결

#### 테스트가 실패하는 경우

1. **검색 결과가 없는 경우**: 벡터 검색 테이블(`memory_item_vec_tfidf`)이 생성되지 않았을 수 있습니다. `sqlite-vec` 확장이 설치되어 있는지 확인하세요.
2. **Ground Truth가 생성되지 않는 경우**: 메모리 ID 목록이 비어있거나 쿼리 수가 0인지 확인하세요.
3. **Baseline 비교 실패**: Baseline 스냅샷 파일이 올바른 형식인지 확인하세요.

#### 리포트 저장 실패

1. **디렉토리 권한**: `data/` 디렉토리에 쓰기 권한이 있는지 확인하세요.
2. **파일 경로**: 절대 경로를 사용하는 경우 경로가 올바른지 확인하세요.

## 참고 자료

- [Search Ranking 공식 문서](../../../reference/en/Search-Ranking-Memory-Decay-Formulas.md)
- [Consolidation Score 시스템 PRD](../../../tasks/0004-prd-consolidation-score-system.md)
- [벡터 검색 품질 검증 PRD](../../../tasks/tasks-0009-prd-vector-search-quality-verification-with-consolidation.md)
- [Memento Goals](../../../reference/en/Memento-Goals.md)

