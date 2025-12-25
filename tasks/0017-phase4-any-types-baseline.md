# Phase 4: 타입 안정성 개선 - any 타입 베이스라인

## 측정 일시
2025-01-25

## 측정 범위
- 디렉토리: `src/domains/anchor/services/anchor/`
- 파일: `*.ts` (테스트 파일 제외)

## 현재 any 타입 개수

### 파일별 any 타입 분포

1. **anchor-manager.ts**: 2개
   - `options?: any` (line 260)
   - `Promise<any>` (line 261)

2. **fallback-strategy.ts**: 2개
   - `options: any | undefined` (line 30)
   - `execute(...args: any[]): Promise<SearchResult>` (line 39)

3. **local-search-service.ts**: 2개
   - `.filter((item: any) => ...)` (line 181)
   - `.map((item: any) => ...)` (line 182)

4. **n-hop-search-service.ts**: 6개
   - `(this.vectorSearchEngine as any).initialize` (여러 위치)

5. **n-hop-search-strategy.ts**: 1개
   - `execute(...args: any[]): Promise<NHopSearchResult[]>` (line 43)

6. **query-filter-strategy.ts**: 1개
   - `execute(...args: any[]): Promise<NHopSearchResult[]>` (line 40)

7. **search-strategy-interfaces.ts**: 2개
   - `execute(...args: any[]): Promise<any>` (line 27)
   - `Promise<any>` (line 73)

### 총계
- **총 any 타입 개수**: 약 16개 (소스 코드 기준)
- **목표**: 50개 이하 (최종 목표)

## any 타입 분류

### 1. 인터페이스 정의 (2개)
- `ISearchStrategy.execute(...args: any[])`
- `IFallbackStrategy.fallback()` 반환 타입

### 2. 메서드 파라미터 (3개)
- `anchor-manager.ts`: `options?: any`
- `fallback-strategy.ts`: `options: any | undefined`

### 3. 타입 단언 (6개)
- `n-hop-search-service.ts`: `as any` 사용 (vectorSearchEngine)

### 4. 배열 처리 (2개)
- `local-search-service.ts`: `item: any` (filter/map)

### 5. 제네릭 타입 (3개)
- 전략 클래스들의 `execute` 메서드

## 개선 우선순위

1. **높음**: 검색 관련 타입 정의 (검색 결과, 검색 옵션)
2. **높음**: 임베딩 관련 타입 정의 (임베딩 결과, 프로바이더)
3. **중간**: DB 경계 타입 정의 (쿼리 결과, 트랜잭션)
4. **중간**: 타입 단언 최소화 (`as any` 제거)
5. **낮음**: 인터페이스 제네릭 타입 개선

## 다음 단계

1. 검색 관련 타입 정의 (`SearchOptions`, `SearchResult` 등)
2. 임베딩 관련 타입 정의 (`EmbeddingResult`, `EmbeddingProvider` 등)
3. DB 경계 타입 정의 (`QueryResult`, `Transaction` 등)
4. 핵심 로직 `any` 타입 제거
5. 타입 가드 활용
6. 제네릭 활용

