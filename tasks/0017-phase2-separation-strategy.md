# Phase 2: anchor-search-service.ts 분리 전략

## 현재 상태
- 파일 크기: 1,262줄
- 목표: 500줄 이하로 분리

## 메서드 분석

### 주요 공개 메서드
1. `searchLocal` (79-232줄, ~154줄) - 국소 검색 메인 메서드
2. `fallbackToGlobalSearch` (689-867줄, ~179줄) - 전역 검색 Fallback

### 주요 private 메서드
1. `searchOneHop` (237-293줄, ~57줄) - 1-hop 검색
2. `searchNHop` (298-590줄, ~293줄) - N-hop 검색
3. `filterByQuery` (122-160줄, 실제 구현 590-684줄, ~95줄) - 쿼리 기반 필터링
4. `getSlotConfig` (943-954줄, ~12줄) - 슬롯 설정
5. `cosineSimilarity` (919-941줄, ~23줄) - 코사인 유사도 계산
6. `calculateRankingScore` (885-918줄, ~34줄) - 랭킹 점수 계산
7. `getRelationTypeBoost` (868-884줄, ~17줄) - 관계 타입 부스트
8. `calculateReanchorScore` (955-1042줄, ~88줄) - 앵커 재설정 점수 계산
9. `analyzeAnchorUsage` (1043-1098줄, ~56줄) - 앵커 사용 분석
10. `generateReanchorReason` (1099-1120줄, ~22줄) - 앵커 재설정 이유 생성
11. `autoReanchor` (1121-1234줄, ~114줄) - 자동 앵커 재설정
12. `checkAndAutoReanchor` (1235-1261줄, ~27줄) - 앵커 재설정 체크

## 분리 전략

### 1. N-hop 검색 서비스 (`n-hop-search-service.ts`)
**책임**: N-hop 검색 로직 담당
- `searchOneHop` 메서드
- `searchNHop` 메서드
- 관련 헬퍼 메서드들
- 예상 크기: ~350줄

### 2. 쿼리 필터 서비스 (`query-filter-service.ts`)
**책임**: 쿼리 기반 필터링 로직 담당
- `filterByQuery` 메서드
- 쿼리 임베딩 생성 및 유사도 계산
- 예상 크기: ~150줄

### 3. Fallback 검색 서비스 (`fallback-search-service.ts`)
**책임**: 전역 검색 Fallback 로직 담당
- `fallbackToGlobalSearch` 메서드
- 예상 크기: ~200줄

### 4. 앵커 재설정 서비스 (`anchor-reanchor-service.ts`, 선택적)
**책임**: 앵커 재설정 관련 로직 담당
- `calculateReanchorScore` 메서드
- `analyzeAnchorUsage` 메서드
- `generateReanchorReason` 메서드
- `autoReanchor` 메서드
- `checkAndAutoReanchor` 메서드
- 예상 크기: ~300줄

### 5. 메인 앵커 검색 서비스 (`anchor-search-service.ts`)
**책임**: 분리된 서비스들을 조합하여 기존 API 유지
- `searchLocal` 메서드 (분리된 서비스들 사용)
- 서비스 초기화 및 설정
- 예상 크기: ~300줄

## 인터페이스 정의

### INHopSearchService
```typescript
interface INHopSearchService {
  searchOneHop(...): Promise<...>;
  searchNHop(...): Promise<...>;
}
```

### IQueryFilterService
```typescript
interface IQueryFilterService {
  filterByQuery(...): Promise<...>;
}
```

### IFallbackSearchService
```typescript
interface IFallbackSearchService {
  fallbackToGlobalSearch(...): Promise<...>;
}
```

## 작업 순서
1. 인터페이스 정의
2. N-hop 검색 서비스 분리 (TDD)
3. 쿼리 필터 서비스 분리 (TDD)
4. Fallback 검색 서비스 분리 (TDD)
5. 메인 서비스 리팩토링
6. 통합 테스트

