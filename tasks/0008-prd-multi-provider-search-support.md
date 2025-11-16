# 0008-prd-multi-provider-search-support.md

## Introduction/Overview

다중 임베딩 제공자(TF-IDF, MiniLM, OpenAI, Gemini) 환경에서 기억 검색 시 일부 기억이 누락되는 문제를 해결합니다. 현재 시스템은 저장된 임베딩 중 가장 많이 사용된 단일 provider만 감지하여 검색을 수행하므로, 여러 provider로 저장된 기억이 혼재하거나 provider를 전환한 경우 검색 결과에서 일부 기억이 제외됩니다.

이 기능은 **다중 Provider 검색 지원**을 통해 모든 provider로 저장된 기억을 검색할 수 있도록 하며, provider 전환 시나리오에서도 이전 provider와 새로운 provider로 저장된 기억 모두를 검색할 수 있게 합니다.

## Goals

1. **다중 Provider 검색 지원**: 여러 provider로 저장된 기억을 모두 검색할 수 있도록 함
2. **Provider 전환 호환성**: Provider 전환 후에도 이전 provider와 새로운 provider로 저장된 기억 모두 검색 가능
3. **검색 결과 완전성 보장**: 관련 기억 누락률을 5% 이하로 유지
4. **정확도 저하 최소화**: Provider별 점수 정규화로 인한 검색 정확도 저하를 ±5% 내로 유지
5. **성능 최적화**: 병렬 검색 및 타임아웃 설정을 통한 응답 시간 최적화 (최대 2초 이내)
6. **API 확장성**: Provider별 검색 옵션 및 마이그레이션 도구 제공

## User Stories

### US-1: 다중 Provider 환경에서 검색
**As a** Memento 사용자  
**I want to** 여러 provider로 저장된 기억을 모두 검색할 수 있도록  
**So that** provider를 혼용하여 저장한 기억을 누락 없이 검색할 수 있습니다.

**시나리오:**
- MiniLM으로 기억 10개 저장
- OpenAI로 기억 5개 저장
- 검색 쿼리 실행 시 모든 15개 기억이 검색 결과에 포함되어야 함

### US-2: Provider 전환 후 검색
**As a** Memento 사용자  
**I want to** Provider 전환 후에도 이전 provider로 저장된 기억을 검색할 수 있도록  
**So that** provider를 변경해도 기존 기억에 접근할 수 있습니다.

**시나리오:**
- TF-IDF로 기억 20개 저장
- 설정을 OpenAI로 변경
- OpenAI로 새 기억 5개 저장
- 검색 쿼리 실행 시 TF-IDF 기억 20개와 OpenAI 기억 5개 모두 검색되어야 함

### US-3: Provider별 선택 검색
**As a** Memento 사용자  
**I want to** 특정 provider로 저장된 기억만 검색할 수 있는 옵션을 사용할 수 있도록  
**So that** 특정 provider의 검색 결과만 확인하거나 성능을 최적화할 수 있습니다.

**시나리오:**
- 여러 provider로 저장된 기억이 있는 경우
- 검색 시 특정 provider만 지정하여 검색 가능
- 예: `recall(query="test", provider_filter=["openai"])`

### US-4: 기억 마이그레이션
**As a** Memento 사용자  
**I want to** 기존 기억을 새로운 provider로 재임베딩할 수 있는 도구를 사용할 수 있도록  
**So that** 모든 기억을 단일 provider로 통일하여 검색 성능과 일관성을 향상시킬 수 있습니다.

**시나리오:**
- TF-IDF로 저장된 기억 100개가 있음
- OpenAI로 전환하고 싶음
- 마이그레이션 도구를 사용하여 모든 기억을 OpenAI로 재임베딩
- 이후 단일 provider 검색으로 성능 최적화

## Functional Requirements

### FR-1: 다중 Provider 감지
- **FR-1.1**: 시스템은 저장된 임베딩의 모든 provider를 감지할 수 있어야 함
- **FR-1.2**: `detectStoredEmbeddingProvider()` 메서드는 단일 provider 대신 모든 provider 목록을 반환해야 함
- **FR-1.3**: 각 provider별 저장된 기억 수와 평균 차원 정보를 제공해야 함

### FR-2: 병렬 다중 Provider 검색
- **FR-2.1**: 각 provider별로 독립적인 벡터 검색을 병렬로 수행해야 함
- **FR-2.2**: 각 provider 검색은 **hard timeout**(기본 2초)을 가져야 함. 2초 내 응답이 없으면 해당 provider 검색을 취소하고 실패 처리
- **FR-2.3**: 일부 provider 검색이 실패해도 다른 provider의 검색 결과는 반환해야 함
- **FR-2.4**: 검색 실패한 provider에 대한 상세한 로그를 기록해야 함 (타임아웃, 에러 메시지 등)

### FR-3: 결과 통합 및 정규화
- **FR-3.1**: 각 provider의 검색 결과 점수를 0-1 범위로 정규화해야 함
  - 기본 전략: Min-Max 정규화 (`normalized_score = (score - min_score) / (max_score - min_score)`)
  - 향후 개선: Provider별 score range 특성을 고려한 provider-aware scaling 전략 도입 가능 (현재는 기본 Min-Max 사용)
- **FR-3.2**: 정규화된 점수로 모든 provider의 결과를 통합해야 함
- **FR-3.3**: 중복 기억(memory_id 기준) 처리 규칙
  - **기본값**: 가장 높은 점수만 유지 (최고 점수 채택)
  - 향후 확장 가능성: 평균값, 최신 provider 점수 우선, provider weight 기반 보정 등
- **FR-3.4**: 통합된 결과를 최종 점수로 재랭킹해야 함

### FR-4: Provider별 검색 옵션
- **FR-4.1**: `HybridSearchQuery`에 `provider_filter` 옵션을 추가해야 함
- **FR-4.2**: `provider_filter`가 지정되면 해당 provider만 검색해야 함
- **FR-4.3**: `provider_filter`가 비어있거나 미지정 시 모든 provider 검색해야 함
- **FR-4.4**: `recall` MCP 도구에 `provider_filter` 파라미터를 추가해야 함

### FR-5: 마이그레이션 도구
- **FR-5.1**: 기존 기억을 새로운 provider로 재임베딩하는 MCP 도구를 제공해야 함
- **FR-5.2**: 마이그레이션 도구는 배치 처리로 동작해야 함 (기본 100개씩)
- **FR-5.3**: 마이그레이션 진행 상황을 로그로 제공해야 함
- **FR-5.4**: 마이그레이션 중 기존 임베딩은 유지하고 새 임베딩을 추가 저장해야 함 (롤백 가능하도록)
- **FR-5.5**: 재임베딩 실패 케이스 처리
  - API 실패(OpenAI API 오류 등), 모델 로딩 실패(GPU 없는 환경에서 MiniLM 등) 등으로 재임베딩이 실패한 경우
  - 해당 메모리는 스킵하고 로그로만 기록
  - 전체 마이그레이션 작업은 중단되지 않고 계속 진행
  - 실패한 메모리 목록을 마이그레이션 결과에 포함

### FR-6: 기존 API 호환성
- **FR-6.1**: 기존 검색 API 시그니처는 변경하지 않아야 함
- **FR-6.2**: `provider_filter` 옵션은 선택적(optional) 파라미터여야 함
- **FR-6.3**: 단일 provider 환경에서는 기존과 동일하게 동작해야 함

### FR-7: 에러 처리 및 로깅
- **FR-7.1**: Provider별 검색 실패 시 상세한 에러 메시지를 로그에 기록해야 함
- **FR-7.2**: 검색 통계에 각 provider별 검색 결과 수를 포함해야 함
- **FR-7.3**: 다중 provider 검색 실행 시간을 측정하고 로그에 기록해야 함

## Non-Goals (Out of Scope)

1. **차원 변환을 통한 검색**: `VectorCompatibilityService`를 사용한 차원 변환은 이번 작업에서 제외. 다중 provider 검색에서 차원이 다른 경우, **provider별 독립 벡터 검색**으로 처리하며 cross-dimension 비교는 수행하지 않는다. 차원 변환은 향후 개선 사항으로 고려.

2. **Provider 자동 선택**: 사용자가 provider를 선택하지 않은 경우 자동으로 최적 provider를 선택하는 기능은 제외. 모든 provider 검색이 기본 동작.

3. **Provider별 가중치 설정**: Provider별로 다른 가중치를 설정하는 기능은 제외. 모든 provider는 동등하게 처리.

4. **실시간 Provider 전환**: 검색 중 provider를 동적으로 전환하는 기능은 제외. Provider 전환은 설정 변경을 통해서만 가능.

5. **Provider별 인덱스 최적화**: 각 provider별로 별도의 인덱스 구조를 최적화하는 작업은 제외. 기존 인덱스 구조 유지.

## Design Considerations

### 검색 결과 통합 알고리즘

```
1. 각 provider별로 벡터 검색 수행 (병렬)
2. 각 provider의 결과 점수를 Min-Max 정규화
   - normalized_score = (score - min_score) / (max_score - min_score)
   - 참고: Provider별 score range 특성(TF-IDF: 값 편차 큼, MiniLM: 0.2~0.8, OpenAI: 0.7~0.9 집중)이 다르지만, 
     현재는 기본 Min-Max 정규화 사용. 향후 provider-aware scaling 전략 도입 가능
3. 중복 제거 (memory_id 기준)
   - 기본값: 최고 점수만 유지
   - 향후 확장: 평균값, 최신 provider 우선, provider weight 기반 보정 등
4. 통합 점수 계산: normalized_score * provider_weight (기본 1.0)
5. 최종 점수로 재랭킹
```

### 병렬 검색 구현

- `Promise.allSettled()`를 사용하여 모든 provider 검색을 병렬로 실행
- 각 검색에 **hard timeout** 설정 (기본 2초)
  - 2초 내 응답이 없으면 해당 provider 검색을 취소하고 실패 처리
  - `Promise.race()`와 타임아웃 Promise를 조합하여 구현
- 실패한 provider는 로그만 기록하고 성공한 provider 결과만 반환

### API 확장

```typescript
interface HybridSearchQuery {
  // ... 기존 필드 ...
  provider_filter?: EmbeddingProvider[]; // 새로 추가
}

// MCP 도구 파라미터
{
  query: string;
  provider_filter?: string[]; // ["openai", "minilm"] 형식
  // ... 기존 파라미터 ...
}
```

### 마이그레이션 도구 설계

```typescript
interface MigrationOptions {
  source_provider?: EmbeddingProvider; // 미지정 시 모든 provider
  target_provider: EmbeddingProvider;
  batch_size?: number; // 기본 100
  dry_run?: boolean; // 시뮬레이션 모드
}

interface MigrationResult {
  total_count: number;
  success_count: number;
  failed_count: number;
  failed_memory_ids: string[]; // 재임베딩 실패한 메모리 ID 목록
  errors: Array<{ memory_id: string; error: string }>; // 상세 에러 정보
}
```

## Technical Considerations

### 1. HybridSearchEngine 수정
- `detectStoredEmbeddingProvider()` → `detectAllStoredEmbeddingProviders()`로 변경
- `executeVectorSearch()` 메서드를 다중 provider 검색으로 확장
- 결과 통합 로직 추가

### 2. VectorSearchEngine 확장
- Provider별 검색을 지원하도록 `search()` 메서드 수정
- Provider 필터링 로직 추가

### 3. 데이터베이스 쿼리 최적화
- Provider별 벡터 검색 쿼리 최적화
- 인덱스 활용 최대화

### 4. 타임아웃 및 에러 처리
- 각 provider 검색에 `Promise.race()`와 타임아웃 사용
- 검색 실패 시 graceful degradation

### 5. 성능 모니터링
- 각 provider별 검색 시간 측정
- 통합 검색 총 소요 시간 측정
- Provider별 결과 수 통계

### 6. 의존성
- 기존 `UnifiedEmbeddingService` 사용`
- `VectorCompatibilityService`는 향후 개선 시 활용 예정

## Success Metrics

### 기능적 기준
- ✅ 여러 provider로 저장된 기억 모두 검색 가능
- ✅ Provider 전환 후에도 모든 기억 검색 가능
- ✅ 검색 결과에 모든 관련 기억 포함 (누락률 < 5%)

### 성능 기준
- ✅ 다중 provider 검색 시 응답 시간 < 2초 (95th percentile)
- ✅ 단일 provider 검색 성능 저하 없음 (기존 대비 ±10% 이내)
- ✅ 병렬 검색으로 인한 CPU 사용률 증가 < 20%

### 정확도 기준
- ✅ 검색 결과 정확도 유지 (단일 provider 대비 ±5% 이내)
- ✅ 관련 기억 누락률 < 5%
- ✅ 중복 기억 제거 정확도 100%

### 모니터링 기준
- ✅ 검색 결과 누락률을 측정하기 위한 샘플링 기반 모니터링 도입
  - 주기적으로 샘플 쿼리에 대해 예상 결과와 실제 결과를 비교
  - Provider별 검색 성공률 및 누락률 추적

### 사용성 기준
- ✅ Provider별 검색 옵션 사용 가능
- ✅ 마이그레이션 도구 정상 동작
- ✅ 에러 발생 시 명확한 로그 메시지 제공

## Open Questions

1. **Provider별 가중치**: 향후 특정 provider의 검색 결과에 더 높은 가중치를 부여하는 기능이 필요한가요?

2. **차원 변환 통합**: 다중 provider 검색 구현 후, 차원 변환 기능을 통합하여 차원이 다른 provider 간 검색을 지원할 계획인가요?

3. **캐싱 전략**: 동일 쿼리에 대해 provider별 검색 결과를 캐싱하여 성능을 향상시킬 필요가 있나요?

4. **마이그레이션 롤백**: 마이그레이션 후 문제가 발생할 경우 롤백 전략이 필요한가요? (현재는 기존 임베딩 유지로 설계)

5. **Provider 제한**: 사용자가 동시에 사용할 수 있는 provider 수에 제한이 필요한가요? (현재는 제한 없음)

6. **통계 수집**: Provider별 검색 성능 및 정확도 통계를 수집하여 향후 최적화에 활용할 계획인가요?

## Implementation Notes

### 주요 변경 파일
- `src/algorithms/hybrid-search-engine.ts`: 다중 provider 검색 로직 추가
- `src/algorithms/vector-search-engine.ts: Provider 필터링 지원
- `src/tools/recall-tool.ts: provider_filter 파라미터 추가
- `src/tools/migrate-embeddings-tool.ts: 새로 생성 (마이그레이션 도구)

### 테스트 시나리오
1. 단일 provider 환경에서 기존 동작 확인
2. 다중 provider 환경에서 모든 기억 검색 확인
3. Provider 전환 시나리오 테스트
4. Provider 필터링 기능 테스트
5. 마이그레이션 도구 테스트
6. 성능 벤치마크 테스트

### 마이그레이션 계획
- 기존 코드와의 호환성 유지
- 점진적 배포 가능하도록 feature flag 고려
- 단계별 테스트 및 검증

