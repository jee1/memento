# Issue 187 Test CPU Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the false FTS fallback path, stop repeated fallback warning spam in tests, and make root `npm test` use bounded fork parallelism by default.

**Architecture:** Keep the existing `SearchEngine` and Vitest structure intact, but remove the specific hot spots causing unnecessary work. The implementation is split into three focused areas: mock query correctness, `SearchEngine` availability caching plus test-aware fallback logging, and root Vitest worker capping. Regression tests cover each behavior directly, and final verification compares the existing noisy baseline against the fixed behavior.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 mocks, Node.js, Vitest `forks` pool

---

## File Map

- Modify: `packages/memento-core/src/test/mock-database.ts`
  - Fix SQL classification order so `COUNT(*)` queries return the correct row shape.
- Modify: `packages/memento-core/src/domains/search/algorithms/search-engine.ts`
  - Add instance-scoped availability caches.
  - Route repeated fallback messages to `debug` during tests.
- Modify: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`
  - Add regression tests for cached availability behavior.
- Create: `packages/memento-core/src/test/mock-database.spec.ts`
  - Add direct regression coverage for `MockDatabase.analyzeQuery()` behavior through `prepare(...).get()`.
- Modify: `vitest.config.ts`
  - Cap worker count for root test execution while keeping `pool: 'forks'`.

## Baseline Notes

Observed before implementation in worktree `feat/issue-187-test-cpu-stabilization`:

- Command: `npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic`
- Result: `46 passed`
- Problem: repeated `[SERVER] [WARN] FTS5 테이블에 데이터가 없음...` and `reflection_notes Fallback 사용` output floods stderr even though tests pass.

### Task 1: Lock In the MockDatabase Regression

**Files:**
- Create: `packages/memento-core/src/test/mock-database.spec.ts`
- Modify: `packages/memento-core/src/test/mock-database.ts`
- Test: `packages/memento-core/src/test/mock-database.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { MockDatabase } from './mock-database.js';

describe('MockDatabase', () => {
  it('returns count rows for COUNT(*) against memory_item_fts', () => {
    const db = new MockDatabase();

    const row = db
      .prepare('SELECT COUNT(*) as count FROM memory_item_fts')
      .get() as { count?: unknown } | null;

    expect(row).toEqual({ count: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/memento-core/src/test/mock-database.spec.ts --reporter=basic
```

Expected:

```text
FAIL
Expected: { count: 2 }
Received: { rowid: 1, rank: 0.8 }
```

- [ ] **Step 3: Write minimal implementation**

Update `packages/memento-core/src/test/mock-database.ts` so the `count(*)` branch is evaluated before the generic `memory_item_fts` branch:

```ts
  private analyzeQuery(sql: string): MockRow[] {
    const lowerSql = sql.toLowerCase();

    if (lowerSql.includes('vec.embedding match')) {
      // existing vector branch unchanged
    }

    if (lowerSql.includes('count(*)')) {
      const tableName = (sql.match(/from\s+(\w+)/i)?.[1] ?? '').trim() || '';
      return [{ count: (this.mockData.get(tableName) ?? []).length }];
    }

    if (lowerSql.includes('memory_item_fts')) {
      return this.mockData.get('memory_item_fts') ?? [];
    }

    if (lowerSql.includes('sqlite_master')) {
      // existing sqlite_master branch unchanged
    }

    return [];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run packages/memento-core/src/test/mock-database.spec.ts --reporter=basic
```

Expected:

```text
Test Files  1 passed
Tests       1 passed
```

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/test/mock-database.ts packages/memento-core/src/test/mock-database.spec.ts
git commit -m "test(search): lock mock FTS count query behavior"
```

### Task 2: Add SearchEngine Availability Caching

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/search-engine.ts`
- Modify: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`
- Test: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`

- [ ] **Step 1: Write the failing cache regression tests**

Add tests to `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`:

```ts
  describe('availability caching', () => {
    it('checks FTS5 availability only once per SearchEngine instance', async () => {
      const spy = vi.spyOn(mockDb, 'prepare');

      await searchEngine.search(mockDb, { query: 'test', limit: 10 });
      await searchEngine.search(mockDb, { query: 'test', limit: 10 });

      const countCalls = spy.mock.calls.filter(([sql]) =>
        String(sql).includes('SELECT COUNT(*) as count FROM memory_item_fts')
      );

      expect(countCalls).toHaveLength(1);
    });
  });
```

If `vi` is not already imported in this test file, extend the import:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic
```

Expected:

```text
FAIL
Expected mock call count: 1
Received: >1
```

- [ ] **Step 3: Implement minimal instance-level caching**

Add cached fields and reuse them in `packages/memento-core/src/domains/search/algorithms/search-engine.ts`:

```ts
export class SearchEngine {
  private ranking: SearchRanking;
  private cachedFts5Availability: boolean | null = null;
  private cachedReflectionNotesAvailability: boolean | null = null;

  constructor() {
    this.ranking = new SearchRanking();
  }
```

Then short-circuit both availability methods:

```ts
  private async checkFTS5Availability(db: Database.Database): Promise<boolean> {
    if (this.cachedFts5Availability !== null) {
      return this.cachedFts5Availability;
    }

    try {
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='memory_item_fts'
      `).get();

      if (!result) {
        this.cachedFts5Availability = false;
        this.logFallback('warn', 'FTS5 테이블이 존재하지 않음, 기본 검색으로 전환');
        return this.cachedFts5Availability;
      }

      const row = db.prepare('SELECT COUNT(*) as count FROM memory_item_fts').get() as { count: number } | undefined;
      const hasData = row != null && Number(row.count) > 0;

      if (!hasData) {
        this.cachedFts5Availability = false;
        this.logFallback('warn', 'FTS5 테이블에 데이터가 없음, 기본 검색으로 전환');
        return this.cachedFts5Availability;
      }

      db.prepare('SELECT * FROM memory_item_fts LIMIT 1').get();
      this.cachedFts5Availability = true;
      return this.cachedFts5Availability;
    } catch (error) {
      this.cachedFts5Availability = false;
      this.logFallback('warn', 'FTS5 사용 불가능, 기본 검색으로 전환', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.cachedFts5Availability;
    }
  }
```

Apply the same cache pattern in `checkReflectionNotesAvailability(db)`.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```bash
npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic
```

Expected:

```text
Test Files  1 passed
Tests       47+ passed
```

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/search/algorithms/search-engine.ts packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts
git commit -m "fix(search): cache availability checks per search engine"
```

### Task 3: Lower Repeated Fallback Logs in Tests

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/search-engine.ts`
- Modify: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`
- Test: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`

- [ ] **Step 1: Write the failing logging regression test**

Add a focused test around the fallback logger path:

```ts
  describe('fallback logging', () => {
    it('does not emit repeated warn logs in test environment', async () => {
      const warnSpy = vi.spyOn(mcpLogger, 'logServer');

      await searchEngine.search(mockDb, { query: 'test', limit: 10 });
      await searchEngine.search(mockDb, { query: 'test', limit: 10 });

      const repeatedWarns = warnSpy.mock.calls.filter(([level, message]) =>
        level === 'warn' &&
        (String(message).includes('FTS5 테이블에 데이터가 없음') ||
          String(message).includes('reflection_notes Fallback 사용'))
      );

      expect(repeatedWarns).toHaveLength(0);
    });
  });
```

Add the import if needed:

```ts
import { mcpLogger } from '../../../../server/mcp-logger.js';
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic
```

Expected:

```text
FAIL
Expected warn count: 0
Received: >0
```

- [ ] **Step 3: Implement localized test-aware fallback logging**

In `packages/memento-core/src/domains/search/algorithms/search-engine.ts`, add a helper that lowers fallback logs during tests without changing the global logger:

```ts
  private isTestEnvironment(): boolean {
    return Boolean(process.env.VITEST ?? process.env.TEST);
  }

  private logFallback(level: 'warn' | 'info' | 'debug', message: string, data?: Record<string, unknown>): void {
    const effectiveLevel = this.isTestEnvironment() && level === 'warn' ? 'debug' : level;
    mcpLogger.logServer(effectiveLevel, message, data);
  }
```

Then replace repeated fallback logging sites, for example:

```ts
this.logFallback('warn', 'FTS5 테이블에 데이터가 없음, 기본 검색으로 전환');
this.logFallback('warn', '마이그레이션 상태로 인해 reflection_notes Fallback 사용');
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```bash
npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic
```

Expected:

```text
Test Files  1 passed
Tests       48+ passed
```

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/search/algorithms/search-engine.ts packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts
git commit -m "fix(search): quiet fallback warnings in tests"
```

### Task 4: Cap Root Vitest Parallelism

**Files:**
- Modify: `vitest.config.ts`
- Test: `vitest.config.ts` via command-line verification

- [ ] **Step 1: Write down the expected config change before editing**

Target change in `vitest.config.ts`:

```ts
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 4,
```

If the installed Vitest version prefers pool-specific worker limits, use the equivalent supported option while keeping the same intent: root file parallelism capped at `4`.

- [ ] **Step 2: Apply the minimal config change**

Update `vitest.config.ts` to add the worker cap next to the existing `pool: 'forks'` setting:

```ts
    pool: 'forks',
    maxWorkers: 4,
```

Do not change:

```ts
    pool: 'threads'
```

Do not add:

```ts
    fileParallelism: false
```

because the selected design is bounded parallelism, not full serialization.

- [ ] **Step 3: Run a quick config-sensitive test command**

Run:

```bash
npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic
```

Expected:

```text
Test Files  1 passed
Tests       48+ passed
```

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "test(vitest): cap default fork parallelism"
```

### Task 5: Final Verification, Graph Rebuild, and Wrap-Up

**Files:**
- Verify: `packages/memento-core/src/test/mock-database.ts`
- Verify: `packages/memento-core/src/test/mock-database.spec.ts`
- Verify: `packages/memento-core/src/domains/search/algorithms/search-engine.ts`
- Verify: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`
- Verify: `vitest.config.ts`

- [ ] **Step 1: Run focused regression coverage**

Run:

```bash
npx vitest run \
  packages/memento-core/src/test/mock-database.spec.ts \
  packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts \
  --reporter=basic
```

Expected:

```text
Test Files  2 passed
Tests       all passed
```

- [ ] **Step 2: Re-run the issue reproduction command and inspect log noise**

Run:

```bash
npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts --reporter=basic 2>&1 | rg "FTS5 테이블에 데이터가 없음|reflection_notes Fallback 사용"
```

Expected:

```text
no output
```

If there is output, it should only appear when explicitly enabling debug-level logging.

- [ ] **Step 3: Rebuild the knowledge graph required by repository rules**

Run:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected:

```text
graph rebuild completes without error
```

- [ ] **Step 4: Review git diff for issue-only scope**

Run:

```bash
git diff -- packages/memento-core/src/test/mock-database.ts \
  packages/memento-core/src/test/mock-database.spec.ts \
  packages/memento-core/src/domains/search/algorithms/search-engine.ts \
  packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts \
  vitest.config.ts
```

Expected:

```text
diff limited to issue 187 changes
```

- [ ] **Step 5: Create the final implementation commit**

```bash
git add packages/memento-core/src/test/mock-database.ts \
  packages/memento-core/src/test/mock-database.spec.ts \
  packages/memento-core/src/domains/search/algorithms/search-engine.ts \
  packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts \
  vitest.config.ts
git commit -m "fix(test): stabilize search fallback path and cap vitest workers"
```
