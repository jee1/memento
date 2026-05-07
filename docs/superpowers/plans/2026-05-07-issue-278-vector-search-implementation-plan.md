# Issue 278 Vector Search Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #278의 반복 `벡터 검색 실패`를 근본적으로 제거하기 위해 VEC 사전 가용성 검사와 실제 검색 실행의 provider/차원/테이블 규칙을 일치시키고 실패 진단 로그를 구조화한다.

**Architecture:** `VectorSearchRepositoryImpl` 내부에서 preflight(`checkVecAvailability`)와 runtime(`search`/`hybridSearch`) 규칙을 공통 헬퍼로 정렬한다. 외부 계약(실패 시 `[]` 반환)은 유지하되, 내부 오류를 `VEC_UNAVAILABLE`, `VECTOR_DIMENSION_MISMATCH`, `VECTOR_SQL_EXECUTION_FAILED`로 분류해 운영 진단력을 높인다.

**Tech Stack:** TypeScript, Node.js 24+, better-sqlite3/sqlite-vec, Vitest

---

## File Structure

- Modify: `packages/memento-core/src/domains/search/repositories/vector-search.repository.ts`
  - 책임: VEC 가용성 확인, 벡터/하이브리드 검색 실행, 차원 정렬, 오류 분류 로깅
- Modify: `packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts`
  - 책임: issue #278 회귀 방지 테스트(가용성-실행 일관성, 차원 불일치, SQL 실패 진단)
- Reference (read-only): `packages/memento-core/src/shared/config/vector-search.config.ts`
  - 책임: provider별 차원 및 테이블 매핑 기준

### Task 1: 먼저 실패를 재현하는 테스트 추가

**Files:**
- Modify: `packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts`
- Test: `packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts`

- [ ] **Step 1: 가용성 검사-실행 불일치 회귀 테스트를 먼저 작성한다 (실패 테스트)**

```ts
describe('issue #278 preflight/runtime consistency', () => {
  it('checkVecAvailability와 search가 동일한 provider/dimension 규칙을 사용해야 함', async () => {
    const query: VectorSearchQuery = {
      queryVector: new Array(512).fill(0.01),
      provider: 'tfidf'
    };

    const available = repository.checkVecAvailability();
    const logSpy = vi.spyOn(mcpLogger, 'logServer');
    await repository.search(query);

    const sqlFailure = logSpy.mock.calls.find(
      (call) => call[0] === 'error' && call[1] === '벡터 검색 실패'
    );

    if (available) {
      expect(sqlFailure).toBeUndefined();
    }

    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 방금 추가한 테스트만 실행해 실패를 확인한다**

Run: `npm test -- packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts -t "issue #278 preflight/runtime consistency"`

Expected: FAIL (현재 구현에서 preflight/runtime 규칙이 완전히 공유되지 않아 로그 assertion 불일치 가능)

- [ ] **Step 3: 오류 분류 로그 테스트를 작성한다 (실패 테스트)**

```ts
it('SQL 실행 실패 시 VECTOR_SQL_EXECUTION_FAILED 분류 로그를 남겨야 함', async () => {
  const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation(() => {
    throw new Error('simulated sqlite failure');
  });
  const logSpy = vi.spyOn(mcpLogger, 'logServer');

  const results = await repository.search({
    queryVector: new Array(384).fill(0.02),
    provider: 'minilm'
  });

  expect(results).toEqual([]);
  expect(
    logSpy.mock.calls.some(
      (call) =>
        call[0] === 'error' &&
        call[1] === '벡터 검색 실패' &&
        String((call[2] as Record<string, unknown>)?.category ?? '').includes('VECTOR_SQL_EXECUTION_FAILED')
    )
  ).toBe(true);

  prepareSpy.mockRestore();
  logSpy.mockRestore();
});
```

- [ ] **Step 4: 두 테스트를 다시 실행해 실패를 확인한다**

Run: `npm test -- packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts -t "issue #278|VECTOR_SQL_EXECUTION_FAILED"`

Expected: FAIL (아직 category 필드 및 정렬 로직 미구현)

- [ ] **Step 5: 테스트 변경만 커밋한다**

```bash
git add packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts
git commit -m "test(search): add issue 278 regression coverage"
```

### Task 2: Repository 규칙 정렬 및 분류 로깅 구현

**Files:**
- Modify: `packages/memento-core/src/domains/search/repositories/vector-search.repository.ts`
- Test: `packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts`

- [ ] **Step 1: preflight/runtime 공통 해석 헬퍼를 추가한다**

```ts
private resolveProvider(provider?: string): string {
  return (provider ?? 'tfidf').toLowerCase();
}

private resolveRuntimeDimensions(provider?: string): { expectedDimensions: number; targetDimensions: number } {
  const resolved = this.resolveProvider(provider);
  const expectedDimensions = this.getExpectedDimensions(resolved);
  let actualStoredDimensions: number | null = null;

  if (this.db && this.shouldUseDominantStoredDimensionsForTable(resolved)) {
    actualStoredDimensions = this.getDominantStoredDimensions(resolved);
  }

  return {
    expectedDimensions,
    targetDimensions: actualStoredDimensions ?? expectedDimensions
  };
}
```

- [ ] **Step 2: `checkVecAvailability()`가 공통 규칙을 사용하도록 변경한다**

```ts
const providersToProbe = ['tfidf', 'minilm', 'openai', 'gemini', 'lightweight'] as const;

for (const provider of providersToProbe) {
  const { expectedDimensions, targetDimensions } = this.resolveRuntimeDimensions(provider);
  const tableName = this.getTableName(provider, targetDimensions);
  const probeVector = JSON.stringify(new Array(expectedDimensions).fill(0));

  const statement = this.db.prepare(
    `SELECT distance FROM ${tableName} WHERE embedding MATCH ? LIMIT 0`
  );
  if (typeof statement.get !== 'function') {
    continue;
  }
  statement.get(probeVector);
}
```

- [ ] **Step 3: `search`/`hybridSearch` catch 로깅에 category를 포함한다**

```ts
} catch (error) {
  mcpLogger.logServer('error', '벡터 검색 실패', {
    category: 'VECTOR_SQL_EXECUTION_FAILED',
    provider: provider ?? 'tfidf',
    tableName,
    expectedDimensions,
    targetDimensions,
    actualVectorLength: Array.isArray(queryVector) ? queryVector.length : -1,
    error: error instanceof Error ? error.message : String(error)
  });
  return [];
}
```

- [ ] **Step 4: 차원 불일치 분기 로깅에 category를 포함한다**

```ts
if (!effectiveQueryVector) {
  mcpLogger.logServer('error', '벡터 차원 불일치', {
    category: 'VECTOR_DIMENSION_MISMATCH',
    provider: provider ?? 'tfidf',
    expected: targetDimensions,
    actual: queryVector.length,
    expectedDimensions,
    actualStoredDimensions
  });
  return [];
}
```

- [ ] **Step 5: 가용성 실패 로그에도 category를 포함한다**

```ts
if (!this.db || !this.isVecAvailable) {
  mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
    category: 'VEC_UNAVAILABLE'
  });
  return [];
}
```

- [ ] **Step 6: Task 1에서 추가한 테스트를 재실행해 통과 확인한다**

Run: `npm test -- packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts -t "issue #278|VECTOR_SQL_EXECUTION_FAILED"`

Expected: PASS

- [ ] **Step 7: 구현 변경을 커밋한다**

```bash
git add packages/memento-core/src/domains/search/repositories/vector-search.repository.ts \
  packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts
git commit -m "fix(search): align vec preflight with runtime and classify failures"
```

### Task 3: 회귀 검증 및 마무리

**Files:**
- Modify: `packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts` (필요 시 assertion 안정화)
- Modify: `docs/superpowers/specs/2026-05-07-issue-278-vector-search-design.md` (필요 시 구현 반영 메모)

- [ ] **Step 1: repository spec 전체를 실행한다**

Run: `npm test -- packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts`

Expected: PASS

- [ ] **Step 2: search 도메인 핵심 테스트를 추가 실행한다**

Run: `npm test -- packages/memento-core/src/domains/search`

Expected: PASS (기존 하이브리드/벡터 동작 회귀 없음)

- [ ] **Step 3: 정적 품질 검사를 실행한다**

Run: `npm run lint && npm run type-check`

Expected: PASS

- [ ] **Step 4: 필요 시 설계 문서에 구현 결과를 한 단락 반영한다**

```md
## Implementation Notes

- `checkVecAvailability` now probes with runtime-equivalent provider/dimension/table rules.
- Failure logs include `category` to separate unavailable/mismatch/sql-execution paths.
```

- [ ] **Step 5: 최종 검증 및 커밋한다**

```bash
git add packages/memento-core/src/domains/search/repositories/vector-search.repository.ts \
  packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts \
  docs/superpowers/specs/2026-05-07-issue-278-vector-search-design.md
git commit -m "test(search): verify issue 278 regression and finalize diagnostics"
```

## Self-Review Checklist

- [ ] Spec coverage: 설계서의 preflight/runtime 정렬, 분류 로그, 테스트 요구사항을 모두 대응하는 Task가 있는지 확인
- [ ] Placeholder scan: `TODO`, `TBD`, "적절히" 같은 모호한 문구가 없는지 확인
- [ ] Type consistency: `category` 필드명과 값(`VEC_UNAVAILABLE`, `VECTOR_DIMENSION_MISMATCH`, `VECTOR_SQL_EXECUTION_FAILED`)이 테스트/구현에서 동일한지 확인
