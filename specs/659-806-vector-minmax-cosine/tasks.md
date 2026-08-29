---
description: "Task list for 벡터 유사도 절대 척도 복원 (#806)"
---

# Tasks: 벡터 유사도 절대 척도 복원 (#806)

**Input**: Design documents from `/specs/659-806-vector-minmax-cosine/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/vector-similarity-contract.md](./contracts/vector-similarity-contract.md)
**Branch**: `659-806-vector-minmax-cosine`

**Tests**: Constitution Principle I에 따라 필수다. 이 작업은 결함 수정이므로 구조 리팩터 예외 대상이 아니다. 예외적으로 T002(변환 정의 이동)만 동작 변경이 없으며, 기존 `vector-search-result-mapper.spec.ts`가 green baseline 역할을 한다.

## Format: `[ID] [Markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 다른 파일을 건드리므로 병렬 실행 가능 |
| `[TDD]` | RED → GREEN → REFACTOR 순서 필수 |
| `[REVIEW]` | 다음 단계로 넘어가기 전 사람 리뷰 |
| `[SUBAGENT]` | 서브에이전트에 위임 가능 |

## Global Constraints (모든 작업에 적용)

- Node.js ≥24, TypeScript ES modules, npm workspaces. 변경은 `packages/memento-core`에 국한
- **동결**: `HYBRID_VECTOR_THRESHOLD`(0.38), `VECTOR_SEARCH_LIMIT_MULTIPLIER`, `VECTOR_UNDERFILL_FILL`, `config/ranking-weights.toml` 값 — **재튜닝 금지**(FR-015)
- **금지**: 격리·프라이버시 필터 구성 변경(FR-022). 프라이버시 범위 필터의 채널 간 비대칭은 이번 범위 밖
- **픽스처**: 커밋되는 검증 데이터는 합성만. 재배포 불가 코퍼스·파생물 커밋 금지
- **스키마 변경 없음**. 마이그레이션 파일을 만들지 않는다
- `graphify-out/`은 커밋하지 않는다
- 검증 명령: `npm test -w packages/memento-core -- <파일경로>`

---

## Phase 1: Setup (기준선 확인)

**Purpose**: 교정 전 상태를 기록해 이후 비교 기준으로 삼는다

- [x] **T001** 기준선 green 확인 및 교정 전 랭킹 버전 식별자 기록

**Files**: 없음(읽기 전용)

```bash
npm ci
npm test -w packages/memento-core 2>&1 | tail -20
```

교정 전 식별자를 기록해 둔다. T014의 SC-017 판정에 쓴다.

```bash
node -e "import('./packages/memento-core/dist/shared/config/ranking-weights-loader.js').then(m=>console.log(m.getRankingVersion()))"
```

빌드가 없으면 `npm run build -w packages/memento-core` 후 실행한다. 출력값(`ranking-sha256:<12자>`)을 메모한다.

**Checkpoint**: 전체 테스트 green. 기준 식별자 기록 완료

---

## Phase 2: Foundational (BLOCKING — 모든 스토리의 선행 조건)

**Purpose**: 거리→유사도 변환 정의를 한 곳으로 모은다. 이 결함의 근본 원인이 경로별 중복 구현이므로, 이 단계 없이 개별 경로를 고치면 재발 조건이 남는다.

**⚠️ CRITICAL**: T002~T003 완료 전에는 어떤 스토리 작업도 시작하지 않는다.

### T002 [TDD] 공용 변환 유틸 신설

**Files**:
- Create: `packages/memento-core/src/shared/utils/vector-similarity.ts`
- Create: `packages/memento-core/src/shared/utils/vector-similarity.spec.ts`

**Interfaces**:
- Consumes: `clamp01` from `packages/memento-core/src/shared/utils/clamp.js`
- Produces: `cosineDistanceToSimilarity(distance: number): number` — 이후 T003, T005가 이 이름과 시그니처를 그대로 사용한다

- [x] **Step 1: 실패하는 검증 작성**

`packages/memento-core/src/shared/utils/vector-similarity.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cosineDistanceToSimilarity } from './vector-similarity.js';

describe('cosineDistanceToSimilarity', () => {
  it('distance 0 → similarity 1 (같은 방향)', () => {
    expect(cosineDistanceToSimilarity(0)).toBe(1);
  });

  it('distance 1 → similarity 0 (직교)', () => {
    expect(cosineDistanceToSimilarity(1)).toBe(0);
  });

  it('distance 2 → similarity 0 (반대 방향, 하한 clamp)', () => {
    expect(cosineDistanceToSimilarity(2)).toBe(0);
  });

  it('부동소수 오차로 음수 distance가 와도 상한 1로 clamp', () => {
    expect(cosineDistanceToSimilarity(-0.0000001)).toBe(1);
  });

  it('비유한값은 0', () => {
    expect(cosineDistanceToSimilarity(Number.NaN)).toBe(0);
    expect(cosineDistanceToSimilarity(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('작을수록 큰 유사도 — 방향이 뒤집히지 않는다', () => {
    expect(cosineDistanceToSimilarity(0.2)).toBeGreaterThan(cosineDistanceToSimilarity(0.8));
  });
});
```

- [x] **Step 2: 실패 확인**

```bash
npm test -w packages/memento-core -- src/shared/utils/vector-similarity.spec.ts
```

Expected: FAIL — `Failed to resolve import "./vector-similarity.js"`

- [x] **Step 3: 최소 구현**

`packages/memento-core/src/shared/utils/vector-similarity.ts`:

```ts
/**
 * cosine distance → cosine similarity 변환 (issue #713, #806).
 *
 * vec0 테이블은 `distance_metric=cosine`으로 생성되므로 distance는 [0, 2] 범위의 cosine distance다.
 * `1 - distance`는 [-1, 1]이지만 slot threshold(0.8/0.6/0.4)와 랭킹은 [0, 1] 유사도를 가정하므로,
 * 반대 방향(distance 2)은 하한 0으로, 부동소수 오차로 인한 음수 distance는 상한 1로 clamp한다.
 *
 * 이 정의는 저장소 전체에서 유일해야 한다(#806 FR-020). 경로별로 다시 구현하면
 * 방향이 갈라져 임계값·정렬·표시가 경로마다 다르게 동작한다.
 */
import { clamp01 } from './clamp.js';

export function cosineDistanceToSimilarity(distance: number): number {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    return 0;
  }
  return clamp01(1 - distance);
}
```

- [x] **Step 4: 통과 확인**

```bash
npm test -w packages/memento-core -- src/shared/utils/vector-similarity.spec.ts
```

Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git add packages/memento-core/src/shared/utils/vector-similarity.ts packages/memento-core/src/shared/utils/vector-similarity.spec.ts
git commit -m "refactor(search): extract cosine distance→similarity to shared util (#806)"
```

---

### T003 [TDD] 기존 저장소 매퍼가 공용 정의를 사용하도록 전환

**Files**:
- Modify: `packages/memento-core/src/domains/search/repositories/vector-search/vector-search-result-mapper.ts:26-37`
- Test: `packages/memento-core/src/domains/search/repositories/vector-search/vector-search-result-mapper.spec.ts` (기존 파일, **수정하지 않는다**)

**Interfaces**:
- Consumes: `cosineDistanceToSimilarity` (T002)
- Produces: `cosineDistanceToSimilarity` 재노출 — 기존 import 경로를 쓰는 코드가 깨지지 않는다

- [x] **Step 1: green baseline 확인 (RED 대신)**

동작 변경이 없는 이동이므로 기존 검증이 baseline이다. 먼저 통과하는지 확인한다.

```bash
npm test -w packages/memento-core -- src/domains/search/repositories/vector-search/vector-search-result-mapper.spec.ts
```

Expected: PASS

- [x] **Step 2: 로컬 정의 제거 후 재노출**

`vector-search-result-mapper.ts`에서 `cosineDistanceToSimilarity` 함수 본문(26~37행의 주석 + 함수)을 지우고, 파일 상단 import 블록에 다음을 추가한다.

```ts
import { cosineDistanceToSimilarity } from '../../../../shared/utils/vector-similarity.js';
```

그리고 같은 파일에서 재노출한다.

```ts
/** issue #713/#806: 변환 정의는 shared/utils/vector-similarity.ts 한 곳에만 둔다. */
export { cosineDistanceToSimilarity };
```

`clamp01` import는 파일의 다른 지점(하이브리드 결과 매핑, 79~80행 부근)에서 계속 쓰므로 **지우지 않는다**.

- [x] **Step 3: 동일 검증이 그대로 통과하는지 확인**

```bash
npm test -w packages/memento-core -- src/domains/search/repositories/vector-search/vector-search-result-mapper.spec.ts
npm run type-check -w packages/memento-core
```

Expected: PASS. 검증 파일을 한 줄도 고치지 않고 통과해야 한다. 고쳐야 통과한다면 이동이 아니라 동작 변경이므로 되돌린다.

- [x] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/search/repositories/vector-search/vector-search-result-mapper.ts
git commit -m "refactor(search): reuse shared cosine similarity conversion in result mapper (#806)"
```

**Checkpoint**: 변환 정의가 한 곳이다. 스토리 작업 시작 가능

---

## Phase 3: User Story 1 — 관련 없는 결과가 만점 유사도를 받지 않는다 (P1) 🎯 MVP

**Goal**: 제공자별 결과셋의 최소·최대로 점수를 다시 늘리는 동작을 제거해, 최상위 결과가 무조건 만점을 받지 않게 한다.

**Independent Test**: 저장된 기억과 무관한 쿼리를 실행했을 때 최상위 결과의 벡터 점수가 1.0이 아니고, 관련 있는 쿼리의 최상위 점수와 분포가 구분된다.

### Tests for User Story 1 (선행 작성 필수) ⚠️

### T004 [TDD] [US1] 하이브리드 벡터 실행 지점 검증 파일 신설 — 절대 척도 계약

**Files**:
- Create: `packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts`

> 이 지점에는 **전용 검증 파일이 없다.** 새로 만든다.

**Interfaces**:
- Consumes: `HybridVectorSearchExecutor` 생성자 — `(embeddingService, vectorSearchEngine, queryEmbeddingService, searchLogger, providerDetector?, queryVectorGenerator?)`
- Produces: 이후 T006·T008·T012가 같은 파일에 케이스를 덧붙인다

- [x] **Step 1: 실패하는 검증 작성**

```ts
import { describe, expect, it, vi } from 'vitest';
import { HybridVectorSearchExecutor } from './hybrid-vector-search-executor.js';

function vecResult(id: string, similarity: number) {
  return {
    id,
    content: `content-${id}`,
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z',
    pinned: false,
    tags: [],
    similarity,
  };
}

/** 인덱스를 사용할 수 있는 상태 — 정상 경로로 간다 */
function availableEngine() {
  return {
    initialize: vi.fn(),
    getIndexStatus: () => ({
      available: true,
      tableExists: true,
      recordCount: 10,
      dimensions: 512,
      vecExtensionLoaded: true,
    }),
  };
}

function makeExecutor(providerResults: Record<string, Array<ReturnType<typeof vecResult>>>) {
  const embeddingService = {
    isAvailable: () => true,
    searchBySimilarity: vi.fn(),
    getUnifiedEmbeddingService: () => ({}),
  };
  const searchLogger = { logSearchStep: vi.fn() };
  const providerDetector = vi.fn().mockResolvedValue(
    Object.keys(providerResults).map((provider) => ({ provider, count: 10, dimensions: 512 }))
  );
  const executor = new HybridVectorSearchExecutor(
    embeddingService as never,
    availableEngine() as never,
    {} as never,
    searchLogger as never,
    providerDetector as never
  );
  // 제공자별 검색 결과를 주입한다. 실제 주입 지점은 구현에 맞춰 조정하되,
  // "제공자별 원시 유사도 배열"이 실행 지점에 들어가는 형태를 유지한다.
  (executor as unknown as { getProviderVectorSearchDeps: () => unknown }).getProviderVectorSearchDeps =
    () => ({ providerResults });
  return executor;
}

describe('HybridVectorSearchExecutor 절대 척도 계약 (#806)', () => {
  it('SC-001: 모든 후보가 낮은 유사도면 최상위도 낮은 점수를 유지한다', async () => {
    const executor = makeExecutor({
      tfidf: [vecResult('a', 0.31), vecResult('b', 0.22), vecResult('c', 0.11)],
    });
    const out = await executor.execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    const top = out.results[0]!;
    expect(top.similarity).toBeLessThan(0.4);
    expect(top.similarity).not.toBe(1);
  });

  it('SC-002: 같은 기억의 점수가 결과셋 구성에 따라 달라지지 않는다', async () => {
    const alone = await makeExecutor({ tfidf: [vecResult('a', 0.42)] })
      .execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    const withOthers = await makeExecutor({
      tfidf: [vecResult('a', 0.42), vecResult('b', 0.9), vecResult('c', 0.1)],
    }).execute({} as never, { query: 'q', limit: 10 } as never, 'sid');

    const scoreAlone = alone.results.find((r) => r.id === 'a')!.similarity;
    const scoreWith = withOthers.results.find((r) => r.id === 'a')!.similarity;
    expect(scoreWith).toBe(scoreAlone);
  });

  it('SC-004: 후보 1건과 다건에서 같은 기억의 점수가 같다', async () => {
    const one = await makeExecutor({ tfidf: [vecResult('a', 0.55)] })
      .execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    const many = await makeExecutor({ tfidf: [vecResult('a', 0.55), vecResult('b', 0.77)] })
      .execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    expect(many.results.find((r) => r.id === 'a')!.similarity)
      .toBe(one.results.find((r) => r.id === 'a')!.similarity);
  });

  it('SC-012: 반환되는 모든 점수가 0~1 범위의 유한값이다', async () => {
    const out = await makeExecutor({
      tfidf: [vecResult('a', 1.4), vecResult('b', -0.3), vecResult('c', Number.NaN)],
    }).execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    for (const r of out.results) {
      expect(Number.isFinite(r.similarity)).toBe(true);
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }
  });
});
```

> **주입 지점 주의**: 위 `makeExecutor`의 제공자 결과 주입은 실행 지점의 실제 의존성 구성에 맞춰야 한다. `getProviderVectorSearchDeps()`가 반환하는 의존성을 스텁하는 방식이 가장 침습이 적다. 구현이 다른 형태를 요구하면 **구현을 바꾸지 말고 스텁 방식을 맞춘다.**

- [x] **Step 2: 실패 확인**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
```

Expected: FAIL — SC-001은 `expected 1 to be less than 0.4`로, SC-002/SC-004는 점수 불일치로 실패한다. **SC-001이 1.0으로 실패하는 것을 눈으로 확인한다.** 이것이 이슈가 보고한 증상 그 자체다.

- [x] **Step 3: 커밋(RED 상태 고정)**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
git commit -m "test(search): pin absolute cosine contract for hybrid vector path (#806) [RED]"
```

---

### Implementation for User Story 1

### T005 [TDD] [US1] 제공자별 최소·최대 재조정 제거

**Files**:
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.ts:239-311`

**Interfaces**:
- Consumes: T004의 검증
- Produces: `normalizeAndDeduplicateResults(allResults)` — 시그니처 유지, 내부 동작만 절대 척도로 바뀐다. `normalizeResultsByProvider`·`deduplicateNormalizedResults`·`groupResultsByProvider`는 사라진다

- [x] **Step 1: 재조정 제거 구현**

`normalizeAndDeduplicateResults`, `groupResultsByProvider`, `normalizeResultsByProvider`, `deduplicateNormalizedResults`, `rankResults` 다섯 메서드를 아래 두 메서드로 교체한다.

```ts
  /**
   * #806: 제공자별 결과셋 min-max 재조정을 제거했다.
   * 반환 점수는 절대 cosine similarity이며 결과셋 구성에 의존하지 않는다.
   * 같은 기억이 여러 제공자에서 나오면 절대 유사도의 최댓값을 남긴다(FR-007).
   */
  private normalizeAndDeduplicateResults(
    allResults: Array<VectorSearchResult & { provider: string }>
  ): VectorSearchResult[] {
    return this.rankResults(this.deduplicateByMaxSimilarity(allResults));
  }

  private deduplicateByMaxSimilarity(
    allResults: Array<VectorSearchResult & { provider: string }>
  ): Array<VectorSearchResult & { provider: string }> {
    const resultMap = new Map<string, VectorSearchResult & { provider: string }>();
    allResults.forEach(result => {
      const existing = resultMap.get(result.id);
      if (!existing || result.similarity > existing.similarity) {
        resultMap.set(result.id, result);
      }
    });
    return Array.from(resultMap.values());
  }

  private rankResults(
    deduplicatedResults: Array<VectorSearchResult & { provider: string }>
  ): VectorSearchResult[] {
    return deduplicatedResults
      .map(({ provider: _provider, ...result }) => ({
        ...result,
        similarity: clamp01(result.similarity),
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }
```

파일 상단에 import를 추가한다.

```ts
import { clamp01 } from '../../../shared/utils/clamp.js';
```

> `clamp01`은 FR-017(범위 보장이 재조정에 묻어 있었음)을 명시적 수단으로 옮기는 장치다. 정상 경로는 저장소 매퍼가 이미 변환·clamp를 하지만, 반환 직전 보장을 계약으로 남긴다.

- [x] **Step 2: 통과 확인**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
npm run type-check -w packages/memento-core
```

Expected: PASS (4 tests)

- [x] **Step 3: 사용되지 않는 코드 확인**

```bash
grep -n "normalizedScore" packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.ts
```

Expected: 출력 없음. 남아 있으면 항등 변환이 남은 것이므로 제거한다.

- [x] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.ts
git commit -m "fix(search): drop per-provider min-max rescaling, keep absolute cosine (#806)"
```

### T006 [TDD] [US1] 임계값 순서 계약과 보충 후보 절대 점수 고정

**Files**:
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts` (T004에서 만든 파일에 추가)

- [x] **Step 1: 검증 추가**

```ts
  it('SC-006: 임계값 판정이 어떤 재조정보다 앞선다 — 임계값 미달 후보는 통과분에 없다', async () => {
    const executor = makeExecutor({
      tfidf: [vecResult('hi', 0.90), vecResult('lo', 0.10)],
    });
    const out = await executor.execute({} as never, { query: 'q', limit: 1 } as never, 'sid');
    expect(out.thresholded_ids).toEqual(['hi']);
    expect(out.raw_ids).toEqual(expect.arrayContaining(['hi', 'lo']));
  });

  it('FR-006: 보충으로 채워진 후보도 자기 절대 점수를 유지한다', async () => {
    const executor = makeExecutor({
      tfidf: [vecResult('hi', 0.90), vecResult('lo', 0.10)],
    });
    const out = await executor.execute({} as never, { query: 'q', limit: 2 } as never, 'sid');
    const filled = out.results.find((r) => r.id === 'lo');
    expect(filled).toBeDefined();
    expect(filled!.similarity).toBeCloseTo(0.10, 5);
  });
```

- [x] **Step 2: 실행**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
```

Expected: PASS. T005 구현으로 이미 성립한다. **실패하면 순서 계약이 깨진 것이므로 T005를 다시 본다.**

- [x] **Step 3: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
git commit -m "test(search): pin threshold-before-rescale order and underfill absolute score (#806)"
```

### T007 [REVIEW] [US1] 체크포인트 리뷰

교정의 핵심 변경이므로 다음 스토리로 넘어가기 전 리뷰한다. 확인 항목:

- `normalizedScore` 식별자가 파일에서 완전히 사라졌는가
- 임계값 숫자·보충 설정을 건드리지 않았는가(FR-015)
- 결과 수가 아니라 점수 분포가 달라졌는가 — 결과 수 감소는 회귀 판정 기준이 아니다

**Checkpoint**: US1 완료. 무관한 쿼리의 최상위 만점이 사라진다

---

## Phase 4: User Story 2 — 서로 다른 쿼리의 점수를 비교할 수 있다 (P1)

**Goal**: 대체 경로가 거리값이 아니라 유사도를 반환하게 해, 두 경로가 같은 척도를 따르게 한다. 이 경로는 벡터 인덱스를 쓸 수 없는 환경에서 **상시 동작 모드**이므로 US1만으로는 그런 환경이 교정에서 빠진다.

**Independent Test**: 인덱스 가용 여부를 "사용 불가"로 두고 검색하면, 임계값 통과분이 가장 가까운 후보로 구성되고 점수가 정상 경로와 같은 척도를 갖는다.

### Tests for User Story 2 ⚠️

### T008 [TDD] [US2] 대체 경로 분기·임계값 계약 검증

> **이 작업이 검증하는 것**: 대체 경로가 오류 없이 선택되는가, 그 경로에서도 임계값이 가장 가까운 후보를 남기는가, 결과 객체에 방향이 다른 필드가 없는가. **방향 결함 자체(거리값이 유사도 필드에 들어가는 것)는 임베딩 서비스 안에서 일어나므로 T010이 RED 게이트다.** 여기서 임베딩 서비스를 스텁하면 그 결함을 통과시켜 버리기 때문이다.

**Files**:
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts`

- [x] **Step 1: 검증 추가**

```ts
/** 인덱스를 쓸 수 없는 상태 — 예외 없이 대체 경로로 간다 */
function unavailableEngine() {
  return {
    initialize: vi.fn(),
    getIndexStatus: () => ({
      available: false,
      tableExists: false,
      recordCount: 0,
      dimensions: 512,
      vecExtensionLoaded: false,
    }),
  };
}

describe('대체 경로 척도 계약 (#806)', () => {
  /** 임베딩 서비스가 반환하는 값: 가까운 기억 near(distance 0.05), 먼 기억 far(distance 1.6) */
  function fallbackExecutor() {
    const embeddingService = {
      isAvailable: () => true,
      getUnifiedEmbeddingService: () => ({}),
      searchBySimilarity: vi.fn().mockResolvedValue({
        results: [
          { ...vecResult('near', 0), similarity: 0.95 },
          { ...vecResult('far', 0), similarity: 0.02 },
        ],
        query_embedding_providers: ['tfidf'],
      }),
    };
    return new HybridVectorSearchExecutor(
      embeddingService as never,
      unavailableEngine() as never,
      {} as never,
      { logSearchStep: vi.fn() } as never
    );
  }

  it('SC-011: 인덱스를 쓸 수 없으면 오류 없이 대체 경로로 가고, 임계값 통과분이 가장 가까운 후보다', async () => {
    const out = await fallbackExecutor().execute({} as never, { query: 'q', limit: 1 } as never, 'sid');
    expect(out.fallback_used).toBe(true);
    expect(out.thresholded_ids).toEqual(['near']);
    expect(out.results[0]!.id).toBe('near');
  });

  it('SC-018: 결과 객체에 방향이 다른 근접도 필드가 함께 있지 않다', async () => {
    const out = await fallbackExecutor().execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    for (const r of out.results) {
      expect(r).not.toHaveProperty('score');
      expect(r).not.toHaveProperty('distance');
    }
  });
});
```

> **제공자 정렬 주의(D7)**: 정상 경로는 저장된 모든 제공자를 조회해 최댓값을 남기고, 대체 경로는 쿼리 임베딩 제공자 하나만 조회한다. 두 경로의 값을 직접 비교하는 케이스를 추가한다면 **제공자를 맞춘 뒤** 비교한다. 맞추지 않으면 정상 동작을 결함으로 오판한다.

- [x] **Step 2: 실행**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
```

Expected: PASS. 임베딩 서비스를 스텁했으므로 이 케이스들은 교정 전에도 통과한다 — **정상이다.** 이 작업은 분기와 임계값 계약을 고정하는 것이고, 방향 결함의 RED는 T010이 담당한다. 여기서 실패가 난다면 대체 경로 분기 자체나 임계값·보충 순서가 깨진 것이다.

- [x] **Step 3: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
git commit -m "test(search): pin fallback branch reachability and threshold contract (#806)"
```

### Implementation for User Story 2

### T009 [TDD] [US2] 대체 경로 질의·매퍼 방향 통일

> **⚠️ 선행**: 이 작업 전에 **T010을 먼저 작성해 실패를 확인한다.** 파일 순서상 아래에 있지만 실행 순서는 T010(RED) → T009(GREEN)다.

**Files**:
- Modify: `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts:29-44` (타입), `:273-274`(SQL), `:312-338`(매퍼)

**Interfaces**:
- Consumes: `cosineDistanceToSimilarity` (T002)
- Produces: `VectorSearchResult`에서 `score` 필드가 사라진다. `similarity`는 [0,1] 유사도다

- [x] **Step 1: 행 타입에서 근접도 필드를 거리 하나로 정리**

`SimilaritySearchRow`의 두 필드를 하나로 바꾼다.

```ts
interface SimilaritySearchRow {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed: string | null;
  pinned: number | boolean;
  tags: string | null;
  distance: number;
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
}
```

`VectorSearchResult`(같은 파일 29~44행)에서 `score: number;` 줄을 제거한다.

- [x] **Step 2: SQL이 거리값 하나만 노출하게 한다**

`buildVecSimilarityQuery`의 SELECT 절에서 다음 두 줄을

```ts
      '  v.distance as similarity, ' +
      '  (1 - v.distance) as score ' +
```

한 줄로 바꾼다.

```ts
      '  v.distance as distance ' +
```

- [x] **Step 3: 매퍼가 공용 변환을 적용한다**

파일 상단에 import를 추가한다.

```ts
import { cosineDistanceToSimilarity } from '../../../shared/utils/vector-similarity.js';
```

`mapSimilaritySearchRows`에서 `similarity: row.similarity,`와 `score: row.score,` 두 줄을 한 줄로 바꾼다.

```ts
      similarity: cosineDistanceToSimilarity(row.distance),
```

- [x] **Step 4: 통과 확인**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
npm run type-check -w packages/memento-core
```

Expected: PASS. type-check가 `score` 참조를 잡아내면 그 지점이 잔존 소비자이므로 함께 정리한다(계획 단계 조사에서는 생산 코드 소비자 0건이었다).

- [x] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/memory/services/memory-embedding-service.ts
git commit -m "fix(search): return similarity, not distance, from fallback vector path (#806)"
```

### T010 [TDD] [US2] 대체 경로 방향 RED 게이트 — 임베딩 서비스 행 매핑

**Files**:
- Create: `packages/memento-core/src/domains/memory/services/memory-embedding-service.spec.ts`

> **순서 주의**: 이 작업은 **T009보다 먼저** 작성해 실패를 확인한다. 방향 결함이 이 지점에 있으므로 여기가 진짜 RED 게이트다. DB를 스텁해 SQL → 행 → 매퍼 경로를 그대로 통과시킨다.

**Interfaces**:
- Consumes: `MemoryEmbeddingService.searchBySimilarity(db, query, filters)` — `{ results, query_embedding_providers }` 반환
- Produces: 없음(검증 전용)

- [x] **Step 1: 실패하는 검증 작성**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = [
  {
    id: 'near', content: 'c-near', type: 'episodic', importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z', last_accessed: null, pinned: 0, tags: null,
    distance: 0.05,
  },
  {
    id: 'far', content: 'c-far', type: 'episodic', importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z', last_accessed: null, pinned: 0, tags: null,
    distance: 1.6,
  },
];

vi.mock('../../../shared/utils/database.js', () => ({
  DatabaseUtils: {
    all: vi.fn(async () => rows),
    get: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
  },
}));

const { MemoryEmbeddingService } = await import('./memory-embedding-service.js');

describe('searchBySimilarity 근접도 방향 (#806)', () => {
  let service: InstanceType<typeof MemoryEmbeddingService>;

  beforeEach(() => {
    service = new MemoryEmbeddingService();
    // 쿼리 임베딩만 스텁한다. SQL·행 매핑은 실제 코드를 통과시킨다.
    (service as unknown as { embeddingService: unknown }).embeddingService = {
      isAvailable: () => true,
      generateEmbedding: async () => ({ embedding: [0.1, 0.2, 0.3], provider: 'tfidf' }),
    };
  });

  it('거리가 가까운 행이 더 높은 similarity를 받는다 — 방향 반전 금지', async () => {
    const out = await service.searchBySimilarity({} as never, 'q');
    const near = out.results.find((r) => r.id === 'near')!;
    const far = out.results.find((r) => r.id === 'far')!;

    expect(near.similarity).toBeGreaterThan(far.similarity);
    expect(near.similarity).toBeCloseTo(0.95, 5);
    expect(far.similarity).toBe(0);
  });

  it('결과 객체에 방향이 다른 근접도 필드가 함께 있지 않다', async () => {
    const out = await service.searchBySimilarity({} as never, 'q');
    for (const r of out.results) {
      expect(r).not.toHaveProperty('score');
      expect(r).not.toHaveProperty('distance');
    }
  });

  it('모든 similarity가 0~1 유한값이다', async () => {
    const out = await service.searchBySimilarity({} as never, 'q');
    for (const r of out.results) {
      expect(Number.isFinite(r.similarity)).toBe(true);
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }
  });
});
```

> 생성자 인자나 내부 필드명이 다르면 **검증 쪽을 맞춘다.** 구현을 검증에 맞추려고 바꾸지 않는다.

- [x] **Step 2: 실패 확인**

```bash
npm test -w packages/memento-core -- src/domains/memory/services/memory-embedding-service.spec.ts
```

Expected: FAIL. 교정 전 매퍼는 `row.similarity`를 읽는데 행에는 `distance`만 있으므로 `similarity`가 `undefined`가 되고, `score` 속성도 존재한다. **이 실패가 방향 결함의 증거다.**

- [x] **Step 3: 커밋(RED)**

```bash
git add packages/memento-core/src/domains/memory/services/memory-embedding-service.spec.ts
git commit -m "test(search): pin fallback row-to-similarity direction (#806) [RED]"
```

- [x] **Step 4: T009 구현 후 GREEN 확인**

```bash
npm test -w packages/memento-core -- src/domains/memory/services/memory-embedding-service.spec.ts
```

Expected: PASS (3 tests)

### T011 [REVIEW] [US2] 체크포인트 리뷰

- 대체 경로 결과 객체에 근접도 필드가 하나뿐인가(FR-024)
- SQL에 `1 - v.distance` 같은 변환이 남아 있지 않은가 — 변환은 공용 정의 한 곳뿐이어야 한다(FR-020)
- 격리 필터(프로젝트·소유자·프로세스·세션) 전달 구성이 그대로인가(FR-022)

**Checkpoint**: US1 + US2 완료. 두 경로가 같은 척도를 따른다

---

## Phase 5: User Story 3 — 제공자마다 점수 스케일이 달라도 결과셋에 의존하지 않는다 (P2)

**Goal**: 여러 제공자에서 같은 기억이 나올 때 절대 유사도의 최댓값이 남는지 고정한다.

**Independent Test**: 두 제공자가 같은 기억을 서로 다른 유사도로 반환할 때, 결과에 남는 점수가 둘 중 큰 값이고 결과셋 구성과 무관하다.

### T012 [TDD] [US3] 제공자 간 중복 제거 규칙 고정

**Files**:
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts`

- [x] **Step 1: 검증 추가**

```ts
  it('FR-007: 같은 기억이 여러 제공자에서 나오면 절대 유사도의 최댓값이 남는다', async () => {
    const out = await makeExecutor({
      tfidf: [vecResult('shared', 0.41)],
      minilm: [vecResult('shared', 0.73)],
    }).execute({} as never, { query: 'q', limit: 10 } as never, 'sid');

    const hit = out.results.filter((r) => r.id === 'shared');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.similarity).toBeCloseTo(0.73, 5);
  });

  it('FR-008: 제공자별 결과셋의 최소·최대가 점수에 영향을 주지 않는다', async () => {
    const narrow = await makeExecutor({
      tfidf: [vecResult('x', 0.5)],
      minilm: [vecResult('y', 0.5)],
    }).execute({} as never, { query: 'q', limit: 10 } as never, 'sid');
    const wide = await makeExecutor({
      tfidf: [vecResult('x', 0.5), vecResult('x2', 0.99)],
      minilm: [vecResult('y', 0.5), vecResult('y2', 0.01)],
    }).execute({} as never, { query: 'q', limit: 10 } as never, 'sid');

    expect(wide.results.find((r) => r.id === 'x')!.similarity)
      .toBe(narrow.results.find((r) => r.id === 'x')!.similarity);
    expect(wide.results.find((r) => r.id === 'y')!.similarity)
      .toBe(narrow.results.find((r) => r.id === 'y')!.similarity);
  });
```

- [x] **Step 2: 실행**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
```

Expected: PASS (T005 구현으로 성립). 교정 전이었다면 두 번째 케이스가 실패한다 — `y`는 좁은 결과셋에서 1.0, 넓은 결과셋에서 0.5 부근이 됐을 것이다.

- [x] **Step 3: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
git commit -m "test(search): pin cross-provider max dedup on absolute similarity (#806)"
```

**Checkpoint**: US1 + US2 + US3 완료

---

## Phase 6: User Story 4 — 화면에 보이는 점수와 설명이 실제 값과 일치한다 (P2)

**Goal**: 설명 문구가 절대 유사도를 기준으로 선택되고, 표시 숫자가 점수 필드와 일치하는지 고정한다.

**Independent Test**: 무관한 결과에 "의미적 유사도 높음" 취지의 문구가 붙지 않고, 표시 숫자가 점수 필드와 같다.

> **코드 변경 없음.** 결합기는 이미 절대 기준 임계값으로 문구를 고르고 있었고, 입력이 재조정된 값이었을 뿐이다. US1이 입력을 절대값으로 바꿔 자동 교정된다. 문구 임계값은 동결 대상이므로 조정하지 않는다(FR-015).

### T013 [P] [TDD] [SUBAGENT] [US4] 설명 문구·표시 숫자 검증

**Files**:
- Create: `packages/memento-core/src/domains/search/algorithms/search-result-combiner.spec.ts`

- [x] **Step 1: 검증 작성**

```ts
import { describe, expect, it } from 'vitest';
import { SearchResultCombiner } from './search-result-combiner.js';

function vectorHit(id: string, similarity: number) {
  return {
    id,
    content: `content-${id}`,
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z',
    pinned: false,
    tags: [],
    similarity,
  };
}

describe('SearchResultCombiner 표시 계약 (#806)', () => {
  const combiner = new SearchResultCombiner();

  it('SC-005: 표시 숫자가 점수 필드와 일치한다', () => {
    const out = combiner.combine([], [vectorHit('a', 0.4321) as never], 0.4, 0.6);
    const hit = out.find((r) => r.id === 'a')!;
    expect(hit.recall_reason).toContain(hit.vectorScore.toFixed(3));
  });

  it('SC-013: 낮은 절대 유사도에는 "의미적 유사도 높음"이 붙지 않는다', () => {
    const textResults = [{
      id: 'a', content: 'c', type: 'episodic', importance: 0.5,
      created_at: '2026-08-29T00:00:00.000Z', last_accessed: '2026-08-29T00:00:00.000Z',
      pinned: 0, tags: [], score: 0.2,
    }];
    const out = combiner.combine(textResults as never, [vectorHit('a', 0.25) as never], 0.4, 0.6);
    expect(out[0]!.recall_reason).not.toContain('의미적 유사도 높음');
  });

  it('FR-018: 높은 절대 유사도에는 문구가 붙는다', () => {
    const textResults = [{
      id: 'a', content: 'c', type: 'episodic', importance: 0.5,
      created_at: '2026-08-29T00:00:00.000Z', last_accessed: '2026-08-29T00:00:00.000Z',
      pinned: 0, tags: [], score: 0.2,
    }];
    const out = combiner.combine(textResults as never, [vectorHit('a', 0.92) as never], 0.4, 0.6);
    expect(out[0]!.recall_reason).toContain('의미적 유사도 높음');
  });
});
```

- [x] **Step 2: 실행**

```bash
npm test -w packages/memento-core -- src/domains/search/algorithms/search-result-combiner.spec.ts
```

Expected: PASS. **구현을 고치지 말 것.** 실패하면 US1의 입력 척도가 아직 절대값이 아니라는 뜻이다.

- [x] **Step 3: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/search-result-combiner.spec.ts
git commit -m "test(search): pin recall reason selection on absolute similarity (#806)"
```

**Checkpoint**: 네 스토리 모두 독립적으로 동작

---

## Phase 7: Polish & Cross-Cutting Concerns

### T014 [TDD] 랭킹 버전 식별자에 점수 척도 반영

**Files**:
- Modify: `packages/memento-core/src/shared/config/constants.ts:96` 부근(`HYBRID_SEARCH` 객체)
- Modify: `packages/memento-core/src/shared/config/ranking-weights-loader.ts:189-201`
- Modify: `packages/memento-core/src/shared/config/ranking-weights-loader.spec.ts`

**Interfaces**:
- Produces: `getRankingVersionPayload()`가 `vector_score_scale: string`을 추가로 포함한다

- [x] **Step 1: 실패하는 검증 작성**

`ranking-weights-loader.spec.ts`에 추가한다.

```ts
  it('#806: 랭킹 버전 payload가 점수 척도 규정을 포함한다', () => {
    const payload = getRankingVersionPayload();
    expect(payload).toHaveProperty('vector_score_scale');
    expect(payload.vector_score_scale).toBe('absolute-cosine-v2');
  });
```

`getRankingVersionPayload` import가 없으면 파일 상단 import에 추가한다.

- [x] **Step 2: 실패 확인**

```bash
npm test -w packages/memento-core -- src/shared/config/ranking-weights-loader.spec.ts
```

Expected: FAIL — `expected { weights: ... } to have property "vector_score_scale"`

- [x] **Step 3: 상수 추가**

`constants.ts`의 `HYBRID_SEARCH` 객체 안에 추가한다.

```ts
  /**
   * 벡터 점수 척도 규정 (#806).
   * 점수 산출 방식이 바뀌면 이 값을 올려 랭킹 버전 식별자가 달라지게 한다.
   * 'minmax-v1' = 제공자별 결과셋 재조정(교정 전), 'absolute-cosine-v2' = 절대 cosine(교정 후).
   */
  VECTOR_SCORE_SCALE: 'absolute-cosine-v2',
```

- [x] **Step 4: payload에 포함**

`ranking-weights-loader.ts`의 `getRankingVersionPayload` 반환 타입과 본문에 각각 한 줄씩 추가한다.

```ts
export function getRankingVersionPayload(configPath?: string): {
  weights: RankingWeightsConfig;
  hybrid_vector_threshold: number;
  vector_prefetch_multiplier: number;
  vector_underfill_fill: boolean;
  vector_score_scale: string;
} {
  return {
    weights: getRankingWeights(configPath),
    hybrid_vector_threshold: HYBRID_SEARCH.HYBRID_VECTOR_THRESHOLD,
    vector_prefetch_multiplier: HYBRID_SEARCH.VECTOR_SEARCH_LIMIT_MULTIPLIER,
    vector_underfill_fill: HYBRID_SEARCH.VECTOR_UNDERFILL_FILL,
    vector_score_scale: HYBRID_SEARCH.VECTOR_SCORE_SCALE,
  };
}
```

- [x] **Step 5: 통과 확인 + SC-017 판정**

```bash
npm test -w packages/memento-core -- src/shared/config/ranking-weights-loader.spec.ts
npm run build -w packages/memento-core
node -e "import('./packages/memento-core/dist/shared/config/ranking-weights-loader.js').then(m=>console.log(m.getRankingVersion()))"
```

Expected: T001에서 기록한 값과 **달라야 한다**. 같으면 payload에 반영되지 않은 것이다.

- [x] **Step 6: 커밋**

```bash
git add packages/memento-core/src/shared/config/constants.ts packages/memento-core/src/shared/config/ranking-weights-loader.ts packages/memento-core/src/shared/config/ranking-weights-loader.spec.ts
git commit -m "feat(search): include vector score scale in ranking version identifier (#806)"
```

### T015 [P] [SUBAGENT] 기준 문서에 척도 변경 시점·해석 기준 기록

**Files**:
- Modify: `docs/agents/search-ranking.md`

- [x] **Step 1: 「벡터 similarity 계약」 절 끝에 문단 추가**

```markdown
**척도 변경 이력 (issue #806, 2026-08-29)**: 이 날짜 이전의 하이브리드 벡터 채널은 제공자별
결과셋의 min-max로 점수를 다시 늘려 반환했고, 대체 경로는 거리값을 유사도 필드에 담아 방향이
반대였습니다. 두 결함을 교정해 반환값은 위 계약(`clamp(1 − cosine_distance, 0, 1)`)을 그대로
따릅니다. **해석 기준이 달라집니다**: 교정 전에는 최상위 결과가 사실상 항상 1.0이었으나, 교정
후에는 실제 근접도를 반영해 관련 있는 결과도 0.4~0.7 대에 자주 놓입니다. 낮아진 숫자는 검색
실패가 아니라 정직한 값입니다. 교정 전후 기록은 `getRankingVersion()` 해시로 구분됩니다
(`HYBRID_SEARCH.VECTOR_SCORE_SCALE` 포함). 이전에 저장된 점수 스냅샷은 옛 척도이며
마이그레이션·백필은 수행하지 않았습니다.
```

- [x] **Step 2: 커밋**

```bash
git add docs/agents/search-ranking.md
git commit -m "docs(search-ranking): record vector score scale change and interpretation (#806)"
```

### T016 [P] 비회귀 확인 — 격리·프라이버시 필터 무변경

**Files**: 없음(검사만)

- [x] **Step 1: 필터 전달 구성이 그대로인지 확인**

```bash
git diff main -- packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.ts | grep -E "project_id|owner_id|process_id|session_id|privacy_scope"
```

Expected: 출력 없음. 출력이 있으면 SC-016 위반이므로 되돌린다.

```bash
git diff main -- packages/memento-core/src/domains/memory/services/memory-embedding-service.ts | grep -E "project_id|owner_id|process_id|session_id|privacy_scope"
```

Expected: 출력 없음. **프라이버시 범위 필터의 채널 간 비대칭을 이 작업에서 고치지 않는다** — 보안·권한 범위 변경은 별도 명세가 필요하다.

### T017 앵커·하이브리드 기존 검증 회귀 확인

- [x] **Step 1: 관련 도메인 전체 실행**

```bash
npm test -w packages/memento-core -- src/domains/search
npm test -w packages/memento-core -- src/domains/anchor
```

Expected: PASS. 실패가 나오면 **점수 분포 변화로 깨진 기대값인지, 실제 회귀인지** 구분한다. 결과 수 감소나 순위 변화는 회귀가 아니다(보충 동작이 켜져 있으면 결과 수는 거의 유지된다). 기대값이 재조정된 점수를 전제로 하고 있었다면 그 검증이 교정 대상이다.

### T018 품질 게이트 (Constitution IV, 완료 전 필수)

- [x] **Step 1: 게이트 실행**

```bash
npm run lint
npm run type-check
npm test
```

세 명령이 모두 통과해야 완료다.

### T019 Graphify 게이트 (Constitution IV)

- [x] **Step 1: 리포트 재빌드 후 확인**

프로덕션 코드를 건드렸으므로 필수다.

```bash
npx graphify   # 저장소 표준 명령을 따른다 (AGENTS.md 참조)
cat graphify-out/GRAPH_REPORT.md | head -40
```

경계 위반이 새로 생기지 않았는지 확인한다. **`graphify-out/`은 커밋하지 않는다.**

### T020 [REVIEW] quickstart 판정표로 최종 확인

- [x] **Step 1: [quickstart.md](./quickstart.md) §4 판정표를 위에서 아래로 확인**

| 확인 | 기대 |
|------|------|
| 무관한 쿼리 최상위 점수 | 1.0 아님 |
| 같은 기억, 결과셋만 다름 | 동일 점수 |
| 후보 1건 vs 다건 | 동일 점수 |
| 대체 경로 임계값 통과분 | 가장 가까운 후보 |
| 결과 수 | 거의 유지(점수 분포가 달라짐) |
| 랭킹 버전 식별자 | T001 기록값과 다름 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 의존 없음
- **Phase 2 Foundational (T002→T003)**: Setup 이후. **모든 스토리를 막는다**
- **Phase 3 US1 (T004→T005→T006→T007)**: Foundational 완료 후
- **Phase 4 US2 (T008→T010→T009→T011)**: Foundational 완료 후. **T010(RED)이 T009(구현)보다 먼저다** — 방향 결함은 임베딩 서비스 안에 있으므로 그 지점의 실패를 먼저 확인해야 한다. T008은 실행 지점의 분기·임계값 계약을 고정할 뿐 방향 결함을 잡지 못한다(임베딩 서비스를 스텁하기 때문)
- **Phase 5 US3 (T012)**: T005 완료 후 (구현은 이미 끝났고 계약 고정만 남는다)
- **Phase 6 US4 (T013)**: T005 완료 후 (코드 변경 없음)
- **Phase 7 Polish**: 원하는 스토리가 모두 끝난 뒤

### Within Each User Story

- 검증을 먼저 쓰고 **실패를 확인한 뒤** 구현한다(Constitution I)
- T002 → T003은 순서 고정: 정의를 만든 뒤 기존 사용처를 전환한다
- T009는 타입 → SQL → 매퍼 순서로 진행한다. 순서를 바꾸면 type-check가 중간 상태에서 깨진다

### Parallel Opportunities

- **T013, T015**는 서로 다른 파일이며 `[P] [SUBAGENT]`다. T005 완료 후 동시에 진행 가능
- **T010은 병렬 대상이 아니다.** T009의 RED 게이트이므로 순서를 지킨다
- **T016**은 검사만 하므로 언제든 병렬 실행 가능
- T004·T006·T008·T012는 같은 파일(`hybrid-vector-search-executor.spec.ts`)이므로 **병렬 금지**

### Parallel Example (T005 완료 후)

```bash
# 서로 다른 파일 — 동시에 진행 가능
Task: "T013 설명 문구·표시 숫자 검증 — search-result-combiner.spec.ts"
Task: "T015 기준 문서 척도 변경 기록 — docs/agents/search-ranking.md"
Task: "T016 격리·프라이버시 필터 무변경 확인 (검사만)"
```

---

## Implementation Strategy

### MVP First (US1만)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **정지하고 검증**: 무관한 쿼리의 최상위 만점이 사라졌는가

여기서 멈춰도 이슈가 보고한 증상은 해소된다. 다만 벡터 인덱스를 쓸 수 없는 환경은 아직 교정되지 않았으므로 US2까지가 실질 완료다.

### Incremental Delivery

1. Foundational → 변환 정의 단일화
2. US1 → 무관 결과 만점 제거 (MVP)
3. US2 → 대체 경로 방향 통일 (인덱스 미가용 환경까지 교정)
4. US3 → 제공자 간 규칙 고정
5. US4 → 표시 계약 고정
6. Polish → 실험 식별자·문서·게이트

---

## Requirements Traceability

| 요구사항 | 작업 |
|----------|------|
| FR-001~FR-004 | T004, T005 |
| FR-005 | T006 |
| FR-006 | T006 |
| FR-007, FR-008 | T012 |
| FR-009, FR-018 | T013 |
| FR-010 | T017 |
| FR-011, FR-016 | T010(RED), T009, T008 |
| FR-012, FR-017 | T004(SC-012), T005(clamp01) |
| FR-013 | T015 |
| FR-014 | T017 |
| FR-015 | Global Constraints (전 작업 금지 항목) |
| FR-019 | T015 |
| FR-020 | T002, T003 |
| FR-021 | T009(필드 이름·범위 유지), T017 |
| FR-022 | T016 |
| FR-023 | T014 |
| FR-024 | T010(RED), T009 |
| SC-001, SC-002, SC-004 | T004 |
| SC-003 | **단위 검증 대상 아님** — 평가 성격 기준. 재배포 불가 코퍼스를 쓰는 로컬 측정에서 확인한다(명세 Q15). 합성 픽스처로 단언하면 주입값을 되읽는 동어반복이 된다 |
| SC-005, SC-013 | T013 |
| SC-006 | T006 |
| SC-007, SC-008 | T017 |
| SC-009 | T015 |
| SC-010, SC-011 | T008 |
| SC-018 | T010 |
| SC-012 | T004 |
| SC-014 | T003 (변환 정의가 하나임을 재노출 구조로 고정) |
| SC-015 | T009, T017 |
| SC-016 | T016 |
| SC-017 | T001, T014 |

---

## Notes

- `[P]` = 다른 파일, 의존 없음
- 각 작업 끝에서 커밋한다
- **검증이 실패하는 것을 눈으로 확인한 뒤** 구현한다. RED 게이트는 두 곳이다: T004의 SC-001(교정 전 `1.0`으로 실패 — 이슈가 보고한 증상)과 T010(교정 전 `similarity`가 `undefined` — 방향 결함의 증거)
- 스텁 위치가 결함보다 하류에 있으면 그 검증은 결함을 통과시킨다. T008이 방향 결함을 잡지 못하는 이유이며, 그래서 T010이 따로 있다
- 결과 수 감소를 회귀로 판정하지 않는다
- 임계값·가중치 값을 "검증을 통과시키려고" 손대지 않는다. 통과하지 않으면 검증이나 구현을 본다
