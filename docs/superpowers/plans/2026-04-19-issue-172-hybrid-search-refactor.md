# Issue 172: hybrid-search 복잡도 감소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `hybrid-search.factory.ts`의 Mock 클래스·any 타입을 제거하고, `hybrid-search-engine.ts`의 `combineAndSortResults` 내 DB 조회 로직을 전용 private 메서드로 분리하여 slop-detector 점수를 개선한다.

**Architecture:** 기존 Repository 패턴 활용(파일 추가 없음). factory는 실제 구현체를 사용하도록 교체, engine은 private 메서드 3개를 추출하여 `combineAndSortResults`를 단순화한다.

**Tech Stack:** TypeScript, better-sqlite3, Vitest

**Spec:** `docs/superpowers/specs/2026-04-19-issue-172-hybrid-search-refactor-design.md`

---

## File Map

| 작업 | 파일 | 변경 유형 |
|------|------|-----------|
| Task 1 | `packages/memento-core/src/domains/search/factories/hybrid-search.factory.ts` | 수정 |
| Task 2–3 | `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` | 수정 |
| 회귀 검증 | `packages/memento-core/src/domains/search/factories/__tests__/hybrid-search.factory.spec.ts` | 읽기 전용 |
| 회귀 검증 | `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts` | 읽기 전용 |

---

## Task 1: factory — Mock 클래스 제거 및 타입 수정

**Files:**
- Modify: `packages/memento-core/src/domains/search/factories/hybrid-search.factory.ts`

### 배경

현재 factory 파일 문제:
- `MockSearchResultCombiner` — 단순 concat, 실제 `SearchResultCombiner`가 있는데 사용 안 함
- `MockAdaptiveWeightCalculator` — 0.6/0.4 하드코딩, 실제 `AdaptiveWeightCalculator`가 있는데 사용 안 함
- `MockSearchLogger` — `ISearchLogger` 시그니처 불일치 (`logSearchStart(query)` vs `logSearchStart(searchId, query)`)
- `createEngine()` 파라미터 6개 전부 `any`

---

- [ ] **Step 1: 현재 테스트가 green인지 확인**

```bash
cd /home/jee1lee/git/memento
npm run type-check 2>&1 | tail -5
npm test -- --reporter=dot 2>&1 | tail -10
```

Expected: 타입 에러 없음, 테스트 green. 이 baseline을 기억한다.

---

- [ ] **Step 2: 워크트리 생성**

```bash
cd /home/jee1lee/git/memento
git worktree add ../memento-issue-172 -b fix/issue-172-hybrid-search-refactor
cd ../memento-issue-172
npm install
```

Expected: 워크트리가 `../memento-issue-172`에 생성됨.

---

- [ ] **Step 3: factory 파일 전체 교체**

`packages/memento-core/src/domains/search/factories/hybrid-search.factory.ts` 를 아래 내용으로 교체한다. 기존 Mock 3개를 삭제하고 `DefaultSearchLogger`를 인라인으로 추가하며, 실제 구현체를 사용하고 `any` 타입을 제거한다.

```typescript
/**
 * 하이브리드 검색 엔진 팩토리
 * 의존성 주입 및 객체 생성 관리
 */

import {
  HybridSearchEngine,
  AdaptiveWeightCalculator,
  resolveQueryUnifiedEmbeddingForHybridSearch,
} from '../algorithms/hybrid-search-engine.js';
import type {
  ITextSearchEngine,
  IEmbeddingService,
  IVectorSearchEngine,
  ISearchResultCombiner,
  IAdaptiveWeightCalculator,
  ISearchLogger,
  HybridSearchQuery,
} from '../algorithms/hybrid-search-engine.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { SearchResultCombiner } from '../algorithms/search-result-combiner.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { VectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { logger } from '../../../shared/utils/logger.js';
import type { Database } from 'better-sqlite3';

class DefaultSearchLogger implements ISearchLogger {
  logSearchStart(searchId: string, query: HybridSearchQuery): void {
    logger.debug('하이브리드 검색 시작', { searchId, query: query.query });
  }

  logSearchStep(searchId: string, step: string, data: unknown): void {
    logger.debug(`하이브리드 검색 단계: ${step}`, { searchId, data });
  }

  logSearchComplete(
    searchId: string,
    result: { items: unknown[]; total_count: number },
    queryTime: number
  ): void {
    logger.info('하이브리드 검색 완료', {
      searchId,
      resultCount: result.total_count,
      queryTime,
    });
  }

  logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void {
    logger.error('하이브리드 검색 오류', { searchId, error, query: query.query });
  }
}

export interface CreateDefaultHybridEngineOptions {
  /** 지정 시 해당 TOML에서 랭킹 가중치 로드 (미지정 시 기본 config/ranking-weights.toml 등) */
  rankingWeightsPath?: string;
}

export class HybridSearchFactory {
  /**
   * 기본 설정으로 하이브리드 검색 엔진 생성
   */
  static createDefaultEngine(
    db: Database,
    embeddingService?: MemoryEmbeddingService,
    options?: CreateDefaultHybridEngineOptions
  ): HybridSearchEngine {
    const textSearchEngine = new SearchEngine();
    const emb = embeddingService ?? new MemoryEmbeddingService();
    const vectorSearchEngine = new VectorSearchEngine();
    const resultCombiner = new SearchResultCombiner();
    const weightCalculator = new AdaptiveWeightCalculator();
    const searchLogger = new DefaultSearchLogger();

    return new HybridSearchEngine(
      textSearchEngine,
      emb,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      searchLogger,
      resolveQueryUnifiedEmbeddingForHybridSearch(emb),
      undefined,
      undefined,
      options?.rankingWeightsPath
    );
  }

  /**
   * 의존성 주입으로 하이브리드 검색 엔진 생성
   */
  static createEngine(
    textSearchEngine: ITextSearchEngine,
    embeddingService: IEmbeddingService,
    vectorSearchEngine: IVectorSearchEngine,
    resultCombiner: ISearchResultCombiner,
    weightCalculator: IAdaptiveWeightCalculator,
    searchLogger: ISearchLogger
  ): HybridSearchEngine {
    const queryUnified = resolveQueryUnifiedEmbeddingForHybridSearch(embeddingService);
    return new HybridSearchEngine(
      textSearchEngine,
      embeddingService,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      searchLogger,
      queryUnified
    );
  }
}
```

---

- [ ] **Step 4: 타입 체크 실행**

```bash
npm run type-check 2>&1 | grep -E "error|warning|hybrid-search.factory" | head -30
```

Expected: 에러 없음. 만약 factory 테스트 파일에서 타입 에러가 뜨면 (예: `createEngine` 호출 시 inline object가 인터페이스와 불일치) 해당 에러 메시지를 읽고 테스트 파일의 mock 객체에 누락된 프로퍼티를 추가한다.

> **알림**: factory 테스트 파일(`hybrid-search.factory.spec.ts`)에는 `createEngine` 호출 시 `mockEmbeddingService = { generateEmbedding: vi.fn() }` 처럼 `IEmbeddingService`의 일부 메서드만 구현한 객체가 있을 수 있다. 타입 에러가 발생하면 `as IEmbeddingService` 캐스팅을 추가하거나 누락된 메서드를 stub으로 추가한다.

---

- [ ] **Step 5: 기존 테스트 실행**

```bash
npm test -- --reporter=dot packages/memento-core/src/domains/search/factories 2>&1 | tail -20
```

Expected: 모든 테스트 PASS.

---

- [ ] **Step 6: 커밋**

```bash
git add packages/memento-core/src/domains/search/factories/hybrid-search.factory.ts
git commit -m "refactor(search): replace mock classes with real implementations in HybridSearchFactory

- Remove MockSearchResultCombiner, MockAdaptiveWeightCalculator, MockSearchLogger
- Add DefaultSearchLogger implementing ISearchLogger correctly
- Use SearchResultCombiner and AdaptiveWeightCalculator directly
- Replace any types in createEngine() with proper interfaces

Fixes part of #172"
```

---

## Task 2: engine — `fetchProcessAttributeContext` + `fetchFeedbackScores` 추출

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts`

### 배경

`combineAndSortResults` Step 2 내부 (~50줄)에 아래 두 로직이 직접 박혀있다:
1. `processId` 기반 ProcessAttributeRepository 조회 + memory_item 상세 조회
2. FeedbackRepository.getNetScores() 호출 (에러 처리 포함)

이를 각각 private 메서드로 추출한다. **동작은 변경하지 않는다.**

---

- [ ] **Step 1: 현재 engine 테스트가 green인지 확인**

```bash
npm test -- --reporter=dot packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts 2>&1 | tail -10
```

Expected: PASS.

---

- [ ] **Step 2: `fetchFeedbackScores` private 메서드 추가**

`hybrid-search-engine.ts`에서 `fetchConsolidationScores` 메서드(라인 ~1591) 바로 뒤에 아래 메서드를 삽입한다.

```typescript
  private fetchFeedbackScores(
    db: Database.Database,
    memoryIds: string[]
  ): Map<string, number> {
    try {
      const feedbackRepo = new FeedbackRepository(db);
      return feedbackRepo.getNetScores(memoryIds, 90);
    } catch (err) {
      logger.warn('피드백 순합 조회 실패 — 피드백 없이 진행', {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Map();
    }
  }
```

---

- [ ] **Step 3: `fetchProcessAttributeContext` private 메서드 추가**

같은 위치(또는 `fetchFeedbackScores` 바로 뒤)에 삽입한다.

```typescript
  private fetchProcessAttributeContext(
    db: Database.Database,
    memoryIds: string[],
    processId: string | undefined
  ): {
    processAttributes: ProcessAttribute | null;
    memoryDetailsMap: Map<string, { tags?: string[]; workflow_name?: string | null; skill_name?: string | null }>;
  } {
    if (!processId) {
      return { processAttributes: null, memoryDetailsMap: new Map() };
    }
    const attrRepo = new ProcessAttributeRepository(db);
    const processAttributes = attrRepo.getByProcessId(processId);
    const memoryDetailsMap = new Map<
      string,
      { tags?: string[]; workflow_name?: string | null; skill_name?: string | null }
    >();
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id, tags, workflow_name, skill_name FROM memory_item WHERE id IN (${placeholders})`
        )
        .all(...memoryIds) as Array<{
        id: string;
        tags: string | null;
        workflow_name: string | null;
        skill_name: string | null;
      }>;
      for (const row of rows) {
        let tags: string[] = [];
        if (row.tags) {
          try {
            const parsed = JSON.parse(row.tags);
            tags = Array.isArray(parsed) ? parsed : [];
          } catch {
            tags = [];
          }
        }
        memoryDetailsMap.set(row.id, {
          tags,
          workflow_name: row.workflow_name ?? null,
          skill_name: row.skill_name ?? null,
        });
      }
    }
    return { processAttributes, memoryDetailsMap };
  }
```

---

- [ ] **Step 4: 타입 체크 및 테스트 실행**

```bash
npm run type-check 2>&1 | grep -E "error" | head -20
npm test -- --reporter=dot packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts 2>&1 | tail -10
```

Expected: 에러 없음, PASS. (아직 `combineAndSortResults`는 건드리지 않았으므로 동작 변화 없음)

---

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts
git commit -m "refactor(search): extract fetchFeedbackScores and fetchProcessAttributeContext

Isolate DB query logic from combineAndSortResults into dedicated private methods.
No behavioral change.

Part of #172"
```

---

## Task 3: engine — `buildRankingContext` 신설 및 `combineAndSortResults` 단순화

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts`

---

- [ ] **Step 1: `buildRankingContext` private 메서드 추가**

`fetchProcessAttributeContext` 바로 뒤에 삽입한다.

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
  }> {
    const relationData = await this.fetchRelationWeights(db, memoryIds);

    let consolidationScores: Map<string, number> = new Map();
    if (mementoConfig.consolidationScoreEnabled) {
      consolidationScores = this.fetchConsolidationScores(db, memoryIds);
    }

    const proceduralMatches = this.proceduralMemoryMatcher.fetchProceduralMemoryMatches(
      db,
      memoryIds,
      query
    );

    const { processAttributes, memoryDetailsMap } = this.fetchProcessAttributeContext(
      db,
      memoryIds,
      processId
    );

    const feedbackScores = this.fetchFeedbackScores(db, memoryIds);

    return {
      relationWeights: relationData.weights,
      relationInfo: relationData.relations,
      consolidationScores,
      proceduralMatches,
      processAttributes,
      memoryDetailsMap,
      feedbackScores,
    };
  }
```

---

- [ ] **Step 2: `combineAndSortResults`의 Step 2 블록을 `buildRankingContext` 호출로 교체**

`combineAndSortResults` 내부에서 `// Step 2:` 주석부터 `this.normalizeScores(...)` 호출까지의 블록을 찾아 아래로 교체한다.

기존 코드 (라인 ~1495–1566):
```typescript
      // Step 2: 관계 그래프와 통합 점수를 활용하여...
      if (db) {
        const memoryIds = combinedResults.map(r => r.id);
        if (memoryIds.length > 0) {
          const relationData = await this.fetchRelationWeights(db, memoryIds);
          // ... (약 50줄의 DB 조회 및 변수 선언)
          this.normalizeScores(
            combinedResults,
            relationWeights,
            relationInfo,
            consolidationScores,
            proceduralMemoryMatches,
            includeRelations,
            processAttributes,
            memoryDetailsMap,
            feedbackNetByMemory,
            query?.include_score_breakdown === true
          );
        }
      }
```

교체 후:
```typescript
      // Step 2: 랭킹 컨텍스트 조회 및 점수 정규화
      if (db) {
        const memoryIds = combinedResults.map(r => r.id);
        if (memoryIds.length > 0) {
          const processId =
            query?.filters?.process_id != null
              ? Array.isArray(query.filters.process_id)
                ? query.filters.process_id[0]
                : query.filters.process_id
              : undefined;
          const ctx = await this.buildRankingContext(db, memoryIds, processId, query);
          this.normalizeScores(
            combinedResults,
            ctx.relationWeights,
            ctx.relationInfo,
            ctx.consolidationScores,
            ctx.proceduralMatches,
            includeRelations,
            ctx.processAttributes,
            ctx.memoryDetailsMap,
            ctx.feedbackScores,
            query?.include_score_breakdown === true
          );
        }
      }
```

---

- [ ] **Step 3: 타입 체크 실행**

```bash
npm run type-check 2>&1 | grep -E "error" | head -20
```

Expected: 에러 없음.

---

- [ ] **Step 4: 전체 관련 테스트 실행**

```bash
npm test -- --reporter=dot packages/memento-core/src/domains/search 2>&1 | tail -20
```

Expected: 모든 테스트 PASS.

---

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts
git commit -m "refactor(search): introduce buildRankingContext to simplify combineAndSortResults

Extract ~50 lines of DB query logic from combineAndSortResults Step 2
into buildRankingContext private method. No behavioral change.

Closes #172"
```

---

## Task 4: 전체 검증 및 PR 생성

---

- [ ] **Step 1: 전체 테스트 실행**

```bash
npm run lint && npm run type-check && npm test 2>&1 | tail -30
```

Expected: lint 통과, 타입 에러 없음, 모든 테스트 PASS.

---

- [ ] **Step 2: 변경 파일 확인**

```bash
git diff main --name-only
```

Expected: 두 파일만 변경됨:
- `packages/memento-core/src/domains/search/factories/hybrid-search.factory.ts`
- `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts`

---

- [ ] **Step 3: PR 생성**

```bash
git push -u origin fix/issue-172-hybrid-search-refactor
gh pr create \
  --title "refactor: hybrid-search 복잡도 감소 (issue #172)" \
  --body "$(cat <<'EOF'
## Summary

- `HybridSearchFactory`의 Mock 클래스 3개 제거 → 실제 구현체(`SearchResultCombiner`, `AdaptiveWeightCalculator`) 사용
- `MockSearchLogger` 대신 `ISearchLogger`를 올바르게 구현한 `DefaultSearchLogger` 인라인 추가
- `createEngine()` 파라미터 `any` × 6 → 타입 인터페이스로 교체
- `combineAndSortResults` 내 ~50줄 DB 조회 블록을 `buildRankingContext` private 메서드로 추출
- `fetchProcessAttributeContext`, `fetchFeedbackScores` private 메서드 추가

## Test plan

- [ ] `npm run lint` 통과
- [ ] `npm run type-check` 통과
- [ ] `npm test` 전체 green

Closes #172

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---
