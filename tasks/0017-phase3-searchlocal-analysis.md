# Phase 3: searchLocal 메서드 분석

## 파일 정보
- **파일 경로**: `src/domains/anchor/services/anchor/anchor-search-service.ts`
- **메서드**: `searchLocal`
- **라인 범위**: 102-255 (약 154줄)

## 현재 구현 분석

### 1. 메서드 시그니처
```typescript
async searchLocal(
  agentId: string,
  slot: AnchorSlot,
  query: string | undefined,
  hopLimit: number | undefined,
  options: SearchOptions | undefined,
  anchorMemoryId: string,
  anchorEmbedding: { embedding: number[]; provider: string },
  startTime: number
): Promise<SearchResult>
```

### 2. 파이프라인 단계 식별

#### 2.1 초기화 및 설정 단계 (116-129줄)
- **책임**: 슬롯별 설정 가져오기, 검색 옵션 기본값 설정
- **코드**:
  - `getSlotConfig(slot)` 호출
  - `finalHopLimit`, `vectorThreshold` 계산
  - `limit`, `minResults`, `useRelations` 기본값 설정
  - `VectorSearchEngine` 검증

#### 2.2 N-hop 검색 수행 단계 (131-140줄)
- **책임**: 앵커를 기준으로 N-hop 검색 수행
- **코드**: `nHopSearchService.searchNHop()` 호출
- **의존성**: Phase 2.3에서 분리된 `NHopSearchService`

#### 2.3 쿼리 필터링 단계 (142-160줄)
- **책임**: 쿼리가 있는 경우 쿼리 기반 필터링 수행
- **코드**: `queryFilterService.filterByQuery()` 호출
- **부가 작업**: 자동 앵커 이동을 위한 쿼리 임베딩 생성 (선택적)
- **의존성**: Phase 2.4에서 분리된 `QueryFilterService`

#### 2.4 결과 포맷팅 단계 (162-172줄)
- **책임**: 검색 결과를 `SearchResult` 형식으로 변환
- **코드**: `filteredResults.map()` 사용하여 포맷팅

#### 2.5 Fallback 처리 단계 (178-240줄)
- **책임**: Local 결과가 `minResults` 미만인 경우 Fallback 수행
- **조건**: `query`가 있고 `localCount < minResults`인 경우
- **코드**: `fallbackSearchService.fallbackToGlobalSearch()` 호출
- **부가 작업**: Local 결과와 Fallback 결과 병합, 중복 제거
- **의존성**: Phase 2.5에서 분리된 `FallbackSearchService`

#### 2.6 최종 결과 반환 단계 (242-254줄)
- **책임**: 최종 `SearchResult` 객체 생성 및 반환
- **코드**: `queryTime` 계산 및 결과 객체 생성

### 3. 파이프라인 단계별 라인 수

| 단계 | 라인 범위 | 라인 수 | 비고 |
|------|----------|---------|------|
| 초기화 및 설정 | 116-129 | 14 | - |
| N-hop 검색 | 131-140 | 10 | Phase 2.3 서비스 사용 |
| 쿼리 필터링 | 142-160 | 19 | Phase 2.4 서비스 사용 |
| 결과 포맷팅 | 162-172 | 11 | - |
| Fallback 처리 | 178-240 | 63 | Phase 2.5 서비스 사용 |
| 최종 결과 반환 | 242-254 | 13 | - |
| **총계** | **102-255** | **154** | - |

### 4. 전략 패턴 적용 가능성 분석

#### 4.1 현재 구조
현재 `searchLocal` 메서드는 이미 Phase 2에서 분리된 서비스들을 사용하고 있습니다:
- `nHopSearchService`: N-hop 검색 전략
- `queryFilterService`: 쿼리 필터링 전략
- `fallbackSearchService`: Fallback 전략

#### 4.2 전략 패턴 적용 목적
Phase 3의 목적은 `searchLocal` 메서드 자체를 더 작은 단위로 분리하고, 각 단계를 전략 패턴으로 구조화하는 것입니다.

#### 4.3 제안하는 구조
```
ISearchStrategy 인터페이스
├── NHopSearchStrategy (nHopSearchService 래핑)
├── QueryFilterStrategy (queryFilterService 래핑)
└── FallbackStrategy (fallbackSearchService 래핑)

LocalSearchService 클래스
├── getAnchorWithEmbedding() - 앵커 정보 및 임베딩 조회
├── performNHopSearch() - N-hop 검색 수행 (NHopSearchStrategy 사용)
├── applyQueryFilter() - 쿼리 필터링 적용 (QueryFilterStrategy 사용)
└── handleFallback() - Fallback 처리 (FallbackStrategy 사용)

AnchorSearchService.searchLocal()
└── LocalSearchService 사용하여 파이프라인 실행
```

### 5. 분리 전략

#### 5.1 `getAnchorWithEmbedding` 단계
- **현재 위치**: `anchor-manager.ts`의 `searchLocal` 메서드 (267-281줄)
- **책임**: 앵커 정보 및 임베딩 조회
- **분리 대상**: `LocalSearchService`로 이동 또는 별도 메서드로 추출

#### 5.2 `performNHopSearch` 단계
- **현재 위치**: `anchor-search-service.ts`의 `searchLocal` 메서드 (131-140줄)
- **책임**: N-hop 검색 수행
- **전략**: `NHopSearchStrategy` 클래스 생성 (Phase 2.3의 `NHopSearchService` 래핑)

#### 5.3 `applyQueryFilter` 단계
- **현재 위치**: `anchor-search-service.ts`의 `searchLocal` 메서드 (142-160줄)
- **책임**: 쿼리 필터링 적용
- **전략**: `QueryFilterStrategy` 클래스 생성 (Phase 2.4의 `QueryFilterService` 래핑)

#### 5.4 `handleFallback` 단계
- **현재 위치**: `anchor-search-service.ts`의 `searchLocal` 메서드 (178-240줄)
- **책임**: Fallback 처리 및 결과 병합
- **전략**: `FallbackStrategy` 클래스 생성 (Phase 2.5의 `FallbackSearchService` 래핑)

### 6. 예상 효과

1. **코드 가독성 향상**: 각 단계가 명확한 메서드로 분리됨
2. **테스트 용이성**: 각 단계를 독립적으로 테스트 가능
3. **유지보수성 향상**: 각 단계의 수정이 다른 단계에 영향을 주지 않음
4. **확장성**: 새로운 전략을 쉽게 추가 가능

### 7. 다음 단계

1. `ISearchStrategy` 인터페이스 정의
2. 각 전략 클래스 구현 (NHopSearchStrategy, QueryFilterStrategy, FallbackStrategy)
3. `LocalSearchService` 클래스 생성
4. `AnchorSearchService.searchLocal` 리팩토링

