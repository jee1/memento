# Issue 172: hybrid-search-engine.ts 복잡도 감소 설계

## 배경

slop-detector 분석에서 아래 두 파일이 **Critical Deficit (Score=50.0)** 로 탐지되었다.

- `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` — 1786줄, 12 이슈
- `packages/memento-core/src/domains/search/factories/hybrid-search.factory.ts` — 111줄, 10 이슈

발견된 주요 문제:

1. **God function** — `combineAndSortResults` 내부에 process attribute 조회, feedback 조회 로직이 직접 박혀있음
2. **높은 순환 복잡도** — DB 조회, 조건 분기, 에러 처리가 한 메서드 안에 혼재
3. **`any` 타입** — `HybridSearchFactory.createEngine()` 파라미터 6개 전부 `any`
4. **Mock 구현체 오용** — 실제 구현체(`SearchResultCombiner`, `AdaptiveWeightCalculator`)가 존재함에도 factory에서 Mock 사용
5. **인터페이스 불일치** — `MockSearchLogger`가 `ISearchLogger` 시그니처와 불일치

## 설계 결정

### 결정 1: Logger 구현체 위치
- **선택**: factory 파일 내 인라인 `DefaultSearchLogger` 클래스
- **이유**: 현재 factory 외부에서 logger를 직접 생성하는 사례 없음. YAGNI — 필요해지면 그때 분리

### 결정 2: DB 쿼리 격리 방식
- **선택**: 기존 `FeedbackRepository`, `ProcessAttributeRepository`로 위임 + private 메서드 추출
- **이유**: 새 추상화 레이어 없이 기존 Repository 패턴 활용. 파일 추가 없이 복잡도 해결 가능

## 변경 범위

### 수정 파일
- `hybrid-search.factory.ts`
- `hybrid-search-engine.ts`

### 추가 파일
없음

## 상세 설계

### hybrid-search.factory.ts

**삭제:**
- `MockSearchResultCombiner` 클래스
- `MockAdaptiveWeightCalculator` 클래스
- `MockSearchLogger` 클래스

**추가:**
- `DefaultSearchLogger` 클래스 (factory 파일 내 인라인, export 없음) — `ISearchLogger` 인터페이스를 정확히 구현
  - `logSearchStart(searchId: string, query: HybridSearchQuery): void`
  - `logSearchStep(searchId: string, step: string, data: unknown): void`
  - `logSearchComplete(searchId: string, result: { items: unknown[]; total_count: number }, queryTime: number): void`
  - `logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void`
  - `logExperiment?(searchId: string, experimentId: string, variant: Record<string, unknown>): void` (optional)
  - **주의**: `hybrid-search-engine.ts`에는 이미 `export class SearchLogger implements ISearchLogger`가 별도로 존재한다. 이 `SearchLogger`는 그대로 유지한다. `DefaultSearchLogger`는 factory 전용 로컬 구현체이므로 두 클래스는 독립적으로 공존한다.

**수정:**
- `createDefaultEngine()` — `MockSearchResultCombiner` → `SearchResultCombiner`, `MockAdaptiveWeightCalculator` → `AdaptiveWeightCalculator`, `MockSearchLogger` → `DefaultSearchLogger`
  - `SearchResultCombiner` import 경로: `'../algorithms/search-result-combiner.js'` (engine 파일을 통한 re-export가 아닌 직접 import)
  - `AdaptiveWeightCalculator` import 경로: `'../algorithms/hybrid-search-engine.js'` (현재 engine 파일에 정의됨)
- `createEngine()` 파라미터 타입: `any` × 6 → `ITextSearchEngine`, `IEmbeddingService`, `IVectorSearchEngine`, `ISearchResultCombiner`, `IAdaptiveWeightCalculator`, `ISearchLogger`

### hybrid-search-engine.ts

**신규 private 메서드 3개 추출:**

#### `fetchProcessAttributeContext`
```typescript
private fetchProcessAttributeContext(
  db: Database.Database,
  memoryIds: string[],
  processId?: string
): {
  processAttributes: ProcessAttribute | null;
  memoryDetailsMap: Map<string, { tags?: string[]; workflow_name?: string | null; skill_name?: string | null }>;
}
```
- `processId`가 없으면 즉시 `{ null, emptyMap }` 반환
- `ProcessAttributeRepository.getByProcessId()` 위임
- memory_item tags/workflow_name/skill_name 조회 SQL 격리

#### `fetchFeedbackScores`
```typescript
private fetchFeedbackScores(
  db: Database.Database,
  memoryIds: string[]
): Map<string, number>
```
- `FeedbackRepository.getNetScores(memoryIds, 90)` 위임 — `90`(일수 파라미터)은 기존 하드코딩 값 그대로 유지
- 에러 시 warn 로그 + 빈 Map 반환 (기존 동작 유지)

#### `fetchProcessAttributeContext` 내 `processId` 추출 위치
- `query?.filters?.process_id`에서 `processId`를 추출하는 로직(`Array.isArray` 분기 포함)은 `combineAndSortResults` 내부에서 `buildRankingContext` 호출 직전에 남긴다.
- `buildRankingContext`는 이미 추출된 `processId?: string`을 받아 `fetchProcessAttributeContext`에 전달한다.

#### `buildRankingContext`
```typescript
private async buildRankingContext(
  db: Database.Database,
  memoryIds: string[],
  processId: string | undefined,
  query?: HybridSearchQuery
): Promise<{
  relationWeights: Map<string, number>;
  relationInfo: Map<string, RelationInfoRow[]>;
  consolidationScores: Map<string, number>;
  proceduralMatches: Map<string, ProceduralMemoryMatch>;
  processAttributes: ProcessAttribute | null;
  memoryDetailsMap: Map<string, { tags?: string[]; workflow_name?: string | null; skill_name?: string | null }>;
  feedbackScores: Map<string, number>;
}>
```
- 기존 `fetchRelationWeights`, `fetchConsolidationScores`, `proceduralMemoryMatcher.fetchProceduralMemoryMatches` 호출
- 신규 `fetchProcessAttributeContext(db, memoryIds, processId)`, `fetchFeedbackScores(db, memoryIds)` 호출
- `combineAndSortResults`의 DB 조회 블록(~50줄)을 이 메서드 한 곳으로 통합

**`normalizeScores` 호출 조립:**
- `buildRankingContext`는 `includeRelations`와 `includeScoreBreakdown`을 반환하지 않는다.
- 이 두 값은 `combineAndSortResults`의 기존 파라미터(`includeRelations: boolean`, `query?.include_score_breakdown === true`)에서 직접 `normalizeScores` 호출 시 전달한다.

**수정:**
- `combineAndSortResults` Step 2 블록 → `processId` 추출 후 `buildRankingContext()` 호출로 대체
- `normalizeScores` 호출부는 `buildRankingContext` 결과 + 기존 파라미터 조합으로 구성

## 변경하지 않는 것

- `HybridSearchEngine.search()` public 시그니처
- 기존 private 메서드: `mergeResults`, `normalizeScores`, `deduplicateResults`, `sortByFinalScore`, `fetchRelationWeights`, `fetchConsolidationScores`, `groupResultsByProvider`, `normalizeResultsByProvider`, `deduplicateNormalizedResults`, `rankResults`
- `AdaptiveWeightCalculator`, `SearchResultCombiner` 클래스 자체
- `hybrid-search-engine.ts` 내 기존 `export class SearchLogger implements ISearchLogger` — 이 클래스는 그대로 유지
- 기존 테스트 파일 (모두 green 유지 필요)

## 테스트 전략

- 기존 `hybrid-search-engine.spec.ts`, `hybrid-search.factory.spec.ts` 전부 green 유지
- `DefaultSearchLogger`는 `ISearchLogger` 인터페이스를 구현하므로 컴파일 타임에 정합성 검증
- 신규 private 메서드(`fetchProcessAttributeContext`, `fetchFeedbackScores`, `buildRankingContext`)는 `combineAndSortResults` 기존 통합 테스트가 간접 커버
- 커밋 전 `npm run lint && npm run type-check && npm test` 통과 필수

## 기대 효과

- `combineAndSortResults` 내부 DB 조회 블록 ~50줄 제거 → 메서드 단순화
- factory의 `any` 타입 6개 제거
- Mock 클래스 3개 → 실제 구현체 사용으로 프로덕션 동작과 일치
- slop-detector 점수 개선 (God function, 순환복잡도, any 타입 이슈 해소)
