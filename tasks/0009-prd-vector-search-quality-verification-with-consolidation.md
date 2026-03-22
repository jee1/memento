# 0009-prd-vector-search-quality-verification-with-consolidation.md

## Introduction/Overview

Consolidation Score 시스템이 벡터 검색 결과에 반영되는 것은 검증되었지만, **벡터 검색 결과 자체의 품질이 consolidation 점수 반영 후에도 유지되는지**를 직접 검증하는 테스트가 부족합니다.

현재 시스템은 `Final_Score = w1 * vector_similarity + w2 * consolidation_score` 공식으로 최종 검색 점수를 계산합니다. 이 기능은 consolidation 점수가 벡터 검색의 의미적 유사도 품질을 손상시키지 않는다는 것을 보장하기 위한 검증 테스트를 추가합니다.

## Goals

1. **벡터 검색 결과 순서 보존 검증**: Consolidation 점수 반영 후에도 벡터 유사도 기반 랭킹의 품질이 유지되는지 검증
2. **품질 지표 비교**: 벡터 유사도만 사용한 경우와 consolidation 점수 반영 후의 Precision/Recall/NDCG 비교
3. **극단적 시나리오 검증**: 벡터 유사도와 consolidation 점수의 극단적 조합에서도 합리적인 랭킹이 유지되는지 검증
4. **Baseline 스냅샷 관리**: 벡터 검색 품질의 baseline을 저장하고 비교할 수 있는 기능 제공
5. **자동화된 품질 검증**: CI/CD 파이프라인에서 자동으로 품질 검증을 수행할 수 있도록 테스트 추가

## User Stories

### US-1: 벡터 검색 순서 보존 검증
**As a** 개발자  
**I want to** consolidation 점수 반영 후에도 벡터 유사도 상위 결과가 유지되는지 검증할 수 있도록  
**So that** consolidation 점수가 벡터 검색의 의미적 유사도 품질을 손상시키지 않는다는 것을 보장할 수 있습니다.

**시나리오:**
- 벡터 유사도만으로 정렬한 상위 10개 결과가 있음
- Consolidation 점수 반영 후에도 이 중 최소 8개(80%)가 상위 10개에 포함되어야 함
- Kendall's Tau 순서 일치도가 0.7 이상이어야 함

### US-2: 품질 지표 비교
**As a** 개발자  
**I want to** 벡터 유사도만 사용한 경우와 consolidation 반영 후의 품질 지표를 비교할 수 있도록  
**So that** consolidation 점수 반영으로 인한 품질 저하를 정량적으로 측정할 수 있습니다.

**시나리오:**
- 벡터 유사도만 사용한 경우: NDCG@5 = 0.85
- Consolidation 점수 반영 후: NDCG@5 = 0.82
- 품질 저하율 = (0.85 - 0.82) / 0.85 = 3.5% < 5% (임계값 통과)

### US-3: 극단적 시나리오 검증
**As a** 개발자  
**I want to** 벡터 유사도와 consolidation 점수의 극단적 조합에서도 합리적인 랭킹이 유지되는지 검증할 수 있도록  
**So that** w2 상한(0.4)이 실제로 벡터 검색 품질을 보호하는지 확인할 수 있습니다.

**시나리오:**
- 벡터 유사도 0.3, consolidation 0.9인 경우: 최종 점수가 합리적인 범위 내인지 검증
- 벡터 유사도 0.9, consolidation 0.1인 경우: 벡터 유사도가 우선 반영되는지 검증

### US-4: Baseline 스냅샷 관리
**As a** 개발자  
**I want to** 벡터 검색 품질의 baseline을 저장하고 비교할 수 있도록  
**So that** 코드 변경 후 품질이 저하되었는지 자동으로 감지할 수 있습니다.

**시나리오:**
- 초기 baseline 스냅샷 저장: NDCG@5 = 0.85
- 코드 변경 후 테스트 실행: NDCG@5 = 0.80
- 품질 저하 감지 및 알림

## Functional Requirements

### FR-1: 벡터 검색 결과 순서 보존 검증
- **FR-1.1**: 벡터 유사도만으로 정렬한 결과와 consolidation 점수 반영 후 결과의 순서 변화를 측정할 수 있어야 함
- **FR-1.2**: 상위 K개 결과의 유지율을 계산할 수 있어야 함 (벡터 유사도 상위 K개가 consolidation 반영 후에도 상위에 유지되는 비율)
  - 상위 10개 결과 유지율 >= 80%
  - 상위 5개 결과 유지율 >= 90%
- **FR-1.3**: 순서 변화 지표를 계산할 수 있어야 함
  - Kendall's Tau >= 0.7 (순서 일치도)
  - Spearman's Rho 계산 지원 (선택적)
- **FR-1.4**: 순서 보존 검증 결과를 리포트 형식으로 출력할 수 있어야 함

### FR-2: 벡터 검색 품질 지표 비교
- **FR-2.1**: 벡터 유사도만 사용한 경우의 Precision/Recall/NDCG를 측정할 수 있어야 함
- **FR-2.2**: Consolidation 점수 반영 후의 Precision/Recall/NDCG를 측정할 수 있어야 함
- **FR-2.3**: 품질 저하 임계값을 설정하고 검증할 수 있어야 함
  - NDCG@5 저하율 < 5%
  - Precision@5 저하율 < 10%
  - Recall@5 저하율 < 10%
- **FR-2.4**: Ground Truth 기반 품질 비교를 수행할 수 있어야 함
- **FR-2.5**: 품질 비교 결과를 시각화할 수 있어야 함 (선택적)

### FR-3: 극단적 시나리오 검증
- **FR-3.1**: 벡터 유사도는 낮지만 consolidation 점수가 매우 높은 경우의 랭킹을 검증할 수 있어야 함
  - 예: 벡터 유사도 0.3, consolidation 0.9
  - 최종 점수가 합리적인 범위 내인지 검증
- **FR-3.2**: 벡터 유사도는 높지만 consolidation 점수가 낮은 경우의 랭킹을 검증할 수 있어야 함
  - 예: 벡터 유사도 0.9, consolidation 0.1
  - 벡터 유사도가 우선 반영되는지 검증
- **FR-3.3**: w2 상한(0.4)이 실제로 벡터 검색 품질을 보호하는지 검증할 수 있어야 함
  - w2 = 0.4일 때와 w2 = 0.6일 때의 품질 비교
- **FR-3.4**: 극단적 시나리오 검증 결과를 리포트 형식으로 출력할 수 있어야 함

### FR-4: 테스트 파일 및 헬퍼 함수
- **FR-4.1**: `src/test/test-vector-search-quality-with-consolidation.ts` 파일을 생성해야 함
  - 벡터 검색 결과 품질 검증 메인 테스트 파일
  - 순서 보존, 품질 지표 비교, 극단적 시나리오 검증 통합
- **FR-4.2**: `src/test/helpers/vector-search-quality-metrics.ts` 파일을 생성해야 함
  - 순서 보존 지표 계산 함수 (Kendall's Tau, Spearman's Rho)
  - 상위 K개 결과 유지율 계산 함수
  - 벡터 유사도만 사용한 검색 결과 생성 함수
  - Consolidation 점수 반영 후 검색 결과 생성 함수
- **FR-4.3**: Baseline 스냅샷 저장 및 비교 기능을 제공해야 함
  - Baseline 스냅샷 저장 함수
  - Baseline 스냅샷 로드 함수
  - Baseline과 현재 결과 비교 함수
  - 품질 저하 감지 및 알림 기능

### FR-5: 테스트 데이터 및 Ground Truth
- **FR-5.1**: 테스트용 Ground Truth 데이터를 생성할 수 있어야 함
  - 자동 생성 옵션 (기존 `consolidation-test-data.ts` 활용)
  - 수동 생성 옵션 (JSON 파일 로드)
- **FR-5.2**: 다양한 시나리오를 테스트할 수 있는 샘플 데이터를 제공해야 함
  - 벡터 유사도가 높은 경우
  - Consolidation 점수가 높은 경우
  - 극단적 조합 케이스
- **FR-5.3**: 테스트 데이터의 재현성을 보장해야 함
  - 시드 값 설정 지원
  - 동일 입력에 대한 동일 결과 보장

### FR-6: 리포트 및 로깅
- **FR-6.1**: 검증 결과를 구조화된 리포트 형식으로 출력할 수 있어야 함
  - 순서 보존 검증 결과
  - 품질 지표 비교 결과
  - 극단적 시나리오 검증 결과
- **FR-6.2**: 리포트를 파일로 저장할 수 있어야 함 (JSON, Markdown 형식)
- **FR-6.3**: 품질 저하가 감지된 경우 명확한 경고 메시지를 출력해야 함

### FR-7: CI/CD 통합
- **FR-7.1**: CI/CD 파이프라인에서 자동으로 테스트를 실행할 수 있어야 함
- **FR-7.2**: 테스트 실패 시 빌드를 실패시킬 수 있어야 함 (선택적)
- **FR-7.3**: 테스트 결과를 CI/CD 리포트에 포함할 수 있어야 함

## Non-Goals (Out of Scope)

1. **실시간 품질 모니터링**: 프로덕션 환경에서 실시간으로 품질을 모니터링하는 기능은 제외. 이 기능은 테스트 환경에서의 검증에 집중.

2. **자동 품질 개선**: 품질 저하를 자동으로 개선하는 기능은 제외. 품질 저하를 감지하고 리포트하는 것에 집중.

3. **다양한 가중치 조합 최적화**: 다양한 w1/w2 조합을 자동으로 최적화하는 기능은 제외. 기존 벤치마크 테스트(`consolidation-search-quality-benchmark.ts`)에서 처리.

4. **사용자 피드백 기반 Ground Truth**: 실제 사용자 피드백을 수집하여 Ground Truth를 생성하는 기능은 제외. 테스트용 Ground Truth 생성에 집중.

5. **다중 Provider 품질 비교**: 여러 embedding provider 간의 품질 비교는 제외. 단일 provider 환경에서의 consolidation 점수 영향 검증에 집중.

## Design Considerations

### 벡터 검색 결과 순서 보존 검증 알고리즘

```typescript
// 1. 벡터 유사도만으로 검색 결과 생성
const vectorOnlyResults = await searchWithVectorSimilarityOnly(query);

// 2. Consolidation 점수 반영 후 검색 결과 생성
const consolidationResults = await searchWithConsolidation(query);

// 3. 순서 보존 지표 계산
const kendallTau = calculateKendallTau(
  vectorOnlyResults.map(r => r.id),
  consolidationResults.map(r => r.id)
);

// 4. 상위 K개 유지율 계산
const topKRetention = calculateTopKRetention(
  vectorOnlyResults.slice(0, k),
  consolidationResults.slice(0, k)
);
```

### 품질 지표 비교 알고리즘

```typescript
// 1. Ground Truth 준비
const groundTruth = generateGroundTruth(query);

// 2. 벡터 유사도만 사용한 품질 측정
const vectorOnlyMetrics = calculateQualityMetrics(
  vectorOnlyResults,
  groundTruth
);

// 3. Consolidation 반영 후 품질 측정
const consolidationMetrics = calculateQualityMetrics(
  consolidationResults,
  groundTruth
);

// 4. 품질 저하율 계산
const degradationRate = (vectorOnlyMetrics.ndcg - consolidationMetrics.ndcg) 
  / vectorOnlyMetrics.ndcg;
```

### Baseline 스냅샷 구조

```typescript
interface BaselineSnapshot {
  version: string;
  timestamp: string;
  testConfiguration: {
    dataSize: number;
    weights: {
      vectorSimilarity: number;
      consolidationScore: number;
    };
  };
  metrics: {
    orderPreservation: {
      kendallTau: number;
      top10Retention: number;
      top5Retention: number;
    };
    quality: {
      precision: Record<number, number>;
      recall: Record<number, number>;
      ndcg: Record<number, number>;
    };
    extremeScenarios: {
      lowVectorHighConsolidation: number;
      highVectorLowConsolidation: number;
    };
  };
}
```

### 테스트 파일 구조

```
src/test/
  ├── test-vector-search-quality-with-consolidation.ts  # 메인 테스트 파일
  └── helpers/
      └── vector-search-quality-metrics.ts  # 품질 지표 계산 헬퍼
```

## Technical Considerations

### 1. 기존 코드 재사용
- `src/test/helpers/search-quality-metrics.ts`: Precision/Recall/NDCG 계산 로직 재사용
- `src/test/helpers/consolidation-test-data.ts`: 테스트 데이터 생성 로직 재사용
- `src/test/test-consolidation-search-quality.ts`: E2E 테스트 구조 참고

### 2. 벡터 유사도만 사용한 검색 구현
- `HybridSearchEngine`에 consolidation 점수를 제외한 검색 옵션 추가
- 또는 검색 후 consolidation 점수를 0으로 설정하여 재계산

### 3. 순서 보존 지표 계산
- Kendall's Tau: `stats-kendalls-tau` 라이브러리 사용 또는 직접 구현
- Spearman's Rho: `spearman-rank-correlation` 라이브러리 사용 또는 직접 구현

### 4. Baseline 스냅샷 저장
- JSON 형식으로 `data/vector-search-quality-baseline.json`에 저장
- 버전 관리 및 비교를 위한 메타데이터 포함

### 5. 테스트 실행 시간 최적화
- 병렬 테스트 실행 고려
- 샘플링을 통한 테스트 데이터 크기 조절
- 캐싱을 통한 중복 계산 방지

### 6. 의존성
- 기존 `SearchRanking` 클래스 사용
- 기존 `HybridSearchEngine` 사용
- 기존 품질 지표 계산 헬퍼 재사용

### 7. 에러 처리
- 검색 실패 시 graceful degradation
- 품질 지표 계산 실패 시 명확한 에러 메시지
- Baseline 스냅샷 로드 실패 시 기본값 사용

## Success Metrics

### 기능적 기준
- ✅ 벡터 검색 결과 순서 보존 검증 테스트 통과
  - 상위 10개 결과 유지율 >= 80%
  - 상위 5개 결과 유지율 >= 90%
  - Kendall's Tau >= 0.7
- ✅ 벡터 검색 품질 지표 비교 테스트 통과
  - NDCG@5 저하율 < 5%
  - Precision@5 저하율 < 10%
  - Recall@5 저하율 < 10%
- ✅ 극단적 시나리오 검증 테스트 통과
  - 극단적 조합에서도 합리적인 랭킹 유지
  - w2 상한(0.4)이 품질을 보호하는지 검증

### 성능 기준
- ✅ 테스트 실행 시간 < 30초 (일반적인 테스트 데이터 크기)
- ✅ Baseline 스냅샷 저장/로드 시간 < 1초

### 정확도 기준
- ✅ 순서 보존 지표 계산 정확도 (기존 라이브러리 또는 검증된 구현 사용)
- ✅ 품질 지표 계산 정확도 (기존 `search-quality-metrics.ts` 재사용)

### 사용성 기준
- ✅ 테스트 결과 리포트가 명확하고 이해하기 쉬움
- ✅ Baseline 스냅샷 비교 결과가 직관적임
- ✅ 품질 저하 감지 시 명확한 경고 메시지 제공

### CI/CD 통합 기준
- ✅ CI/CD 파이프라인에서 테스트 자동 실행
- ✅ 테스트 실패 시 적절한 알림 (선택적)
- ✅ 테스트 결과 리포트 생성

## Open Questions

1. **Baseline 스냅샷 업데이트 정책**: Baseline 스냅샷을 언제 업데이트해야 하나요? (코드 변경 후 자동 업데이트 vs 수동 업데이트)

2. **품질 저하 임계값 조정**: 현재 설정한 임계값(NDCG@5 저하율 < 5%)이 적절한가요? 프로젝트 요구사항에 따라 조정이 필요할 수 있습니다.

3. **테스트 데이터 크기**: 테스트에 사용할 데이터 크기는 얼마나 되어야 하나요? (현재 E2E 테스트는 20개, 벤치마크는 100개 사용)

4. **다중 Provider 지원**: 향후 다중 provider 환경에서도 이 테스트를 확장할 계획이 있나요?

5. **실시간 모니터링**: 향후 프로덕션 환경에서 실시간으로 품질을 모니터링하는 기능이 필요한가요?

6. **사용자 피드백 통합**: 실제 사용자 피드백을 수집하여 Ground Truth를 개선하는 기능이 필요한가요?

## Implementation Notes

### 주요 변경 파일
- `src/test/test-vector-search-quality-with-consolidation.ts`: 새로 생성 (메인 테스트 파일)
- `src/test/helpers/vector-search-quality-metrics.ts`: 새로 생성 (순서 보존 지표 계산 헬퍼)
- `src/algorithms/hybrid-search-engine.ts`: 벡터 유사도만 사용한 검색 옵션 추가 (필요시)
- `docs/_work/testing/ko/consolidation-quality-testing.md`: 문서 업데이트

### 테스트 시나리오
1. 벡터 유사도만 사용한 검색 결과 생성
2. Consolidation 점수 반영 후 검색 결과 생성
3. 순서 보존 지표 계산 및 검증
4. 품질 지표 비교 및 검증
5. 극단적 시나리오 검증
6. Baseline 스냅샷 저장 및 비교

### 단계별 구현 계획
1. **Phase 1**: 순서 보존 검증 기능 구현
   - `vector-search-quality-metrics.ts` 헬퍼 함수 구현
   - 순서 보존 지표 계산 함수 구현
   - 기본 테스트 케이스 작성

2. **Phase 2**: 품질 지표 비교 기능 구현
   - 벡터 유사도만 사용한 검색 구현
   - 품질 지표 비교 로직 구현
   - 품질 저하 임계값 검증 로직 구현

3. **Phase 3**: 극단적 시나리오 검증 기능 구현
   - 극단적 조합 테스트 케이스 작성
   - w2 상한 검증 로직 구현

4. **Phase 4**: Baseline 스냅샷 관리 기능 구현
   - Baseline 스냅샷 저장/로드 기능 구현
   - Baseline 비교 기능 구현
   - 품질 저하 감지 및 알림 기능 구현

5. **Phase 5**: 통합 및 문서화
   - 모든 기능 통합 테스트
   - 문서 업데이트
   - CI/CD 파이프라인 통합

### 참고 자료
- `src/test/test-consolidation-search-quality.ts`: E2E 품질 검증 테스트 구조 참고
- `src/test/consolidation-search-quality-benchmark.ts`: 벤치마크 테스트 구조 참고
- `src/test/helpers/search-quality-metrics.ts`: 품질 지표 계산 로직 재사용
- `src/algorithms/search-ranking.ts`: Consolidation 점수 계산 로직 참고
- `docs/_work/testing/ko/consolidation-quality-testing.md`: 품질 검증 가이드 참고
