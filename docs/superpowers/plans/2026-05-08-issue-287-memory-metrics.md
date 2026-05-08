# Issue 287 Memory Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 1GB memory assumption in `getMemoryMetrics()` with host-aware calculations while preserving compatibility and locking semantics with tests.

**Architecture:** Keep all behavior changes localized to `PerformanceMonitor` and its unit tests. Extend the memory metrics contract with explicit RSS and heap percentage fields, then verify both direct metric output and alert path compatibility.

**Tech Stack:** TypeScript, Node.js `os`/`process` APIs, Vitest

---

## File Structure

- Modify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
  - Extend `PerformanceMetrics.memory` shape to include explicit percentage fields.
  - Replace `getMemoryMetrics()` calculation logic and add defensive guards/comments.
- Modify: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`
  - Update typed fixtures to include new fields.
  - Add focused unit tests for `getMemoryMetrics()` semantics and edge cases.
- Verify only: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts` call sites (`collectMetrics`, alert checks, analytics) remain compatible.

### Task 1: Extend Memory Metrics Contract (Type + Fixture Baseline)

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- Modify: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`
- Test: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

- [ ] **Step 1: Write the failing test fixture update**

Add required properties to typed fixture so TypeScript enforces the new contract:

```ts
memory: {
  rss: toBytes(200),
  heapTotal: toBytes(1024),
  heapUsed: toBytes(512),
  external: toBytes(50),
  usagePercent: 50,
  rssUsagePercent: 50,
  heapUsagePercent: 50
},
```

- [ ] **Step 2: Run test to verify it fails before interface change**

Run: `npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

Expected: FAIL with a TypeScript error similar to:
- `Property 'rssUsagePercent' does not exist on type ...`
- or `Object literal may only specify known properties...`

- [ ] **Step 3: Write minimal interface change**

In `PerformanceMetrics`:

```ts
memory: {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  usagePercent: number; // RSS-based primary signal
  rssUsagePercent: number; // Explicit alias of usagePercent
  heapUsagePercent: number; // Supplementary heap/total signal
};
```

- [ ] **Step 4: Run test to verify compile/test baseline passes**

Run: `npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

Expected: PASS for existing tests (new behavior tests not added yet).

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/monitoring/services/performance-monitor.ts \
        packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts
git commit -m "refactor(monitoring): extend memory metrics contract for issue 287"
```

### Task 2: Rework `getMemoryMetrics()` to Host-Aware RSS Semantics

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- Test: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

- [ ] **Step 1: Write failing unit tests for direct metric semantics**

Add a new describe block with at least these tests:

```ts
describe('PerformanceMonitor getMemoryMetrics semantics (issue 287)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('usagePercent is RSS-based and equals rssUsagePercent', () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(1000);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 400,
      heapTotal: 800,
      heapUsed: 200,
      external: 10,
      arrayBuffers: 0
    });

    const monitor = new PerformanceMonitor();
    const metrics = monitor.getMemoryMetrics();

    expect(metrics.usagePercent).toBeCloseTo(40);
    expect(metrics.rssUsagePercent).toBeCloseTo(40);
    expect(metrics.heapUsagePercent).toBeCloseTo(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts -t "getMemoryMetrics semantics"`

Expected: FAIL (missing `rssUsagePercent` / `heapUsagePercent` in return object or mismatched calculations).

- [ ] **Step 3: Implement minimal production code change**

Replace hardcoded logic in `getMemoryMetrics()`:

```ts
const memUsage = process.memoryUsage();
const totalMemory = os.totalmem();

const rssUsagePercent = totalMemory > 0 ? (memUsage.rss / totalMemory) * 100 : 0;
const heapUsagePercent = totalMemory > 0 ? (memUsage.heapUsed / totalMemory) * 100 : 0;

const safeRssPercent = Number.isFinite(rssUsagePercent) ? rssUsagePercent : 0;
const safeHeapPercent = Number.isFinite(heapUsagePercent) ? heapUsagePercent : 0;

return {
  heapUsed: memUsage.heapUsed,
  heapTotal: memUsage.heapTotal,
  rss: memUsage.rss,
  external: memUsage.external,
  usagePercent: safeRssPercent,
  rssUsagePercent: safeRssPercent,
  heapUsagePercent: safeHeapPercent
};
```

- [ ] **Step 4: Add/adjust inline semantics comments**

Document directly in code:

```ts
// usagePercent is intentionally RSS-based for system pressure alerts.
// rssUsagePercent is an explicit alias for compatibility-safe transition.
// heapUsagePercent is supplementary and should not drive primary pressure alerts.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts -t "getMemoryMetrics semantics"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/memento-core/src/domains/monitoring/services/performance-monitor.ts \
        packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts
git commit -m "fix(monitoring): use os.totalmem and rss-based usage in getMemoryMetrics"
```

### Task 3: Guard Cases + Alert Path Regression Lock

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`
- Test: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

- [ ] **Step 1: Write failing guard-case tests**

Add tests for zero-memory and non-finite protections:

```ts
it('returns zero percentages when os.totalmem() is 0', () => {
  vi.spyOn(os, 'totalmem').mockReturnValue(0);
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: 500,
    heapTotal: 800,
    heapUsed: 300,
    external: 0,
    arrayBuffers: 0
  });

  const monitor = new PerformanceMonitor();
  const metrics = monitor.getMemoryMetrics();

  expect(metrics.usagePercent).toBe(0);
  expect(metrics.rssUsagePercent).toBe(0);
  expect(metrics.heapUsagePercent).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails (if guard not implemented yet)**

Run: `npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts -t "returns zero percentages when os.totalmem() is 0"`

Expected: FAIL before guard implementation, PASS after Task 2 guard code is present.

- [ ] **Step 3: Lock alert compatibility with RSS semantics**

Keep existing RSS alert tests and add one assertion that `collectMetrics()` stores alias consistency:

```ts
const metrics = await monitor.collectMetrics();
expect(metrics.memory.usagePercent).toBeCloseTo(metrics.memory.rssUsagePercent);
```

- [ ] **Step 4: Run full monitoring service test file**

Run: `npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts
git commit -m "test(monitoring): cover issue 287 memory metric guards and alias contract"
```

### Task 4: Final Verification + Lint + Type Safety

**Files:**
- Verify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- Verify: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

- [ ] **Step 1: Run targeted type-check/lint/tests for core workspace**

Run:

```bash
npm --workspace @memento/core run type-check
npm --workspace @memento/core run lint
npm --workspace @memento/core test -- src/domains/monitoring/services/__tests__/performance-monitor.spec.ts
```

Expected:
- Type-check: no errors
- Lint: no new violations
- Test: PASS

- [ ] **Step 2: Run graphify rebuild required by workspace rule**

Run:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: graph rebuild completes without error.

- [ ] **Step 3: Commit verification-only updates if any generated artifacts changed**

```bash
git status --short
git add <only-intended-generated-files-if-changed>
git commit -m "chore(graphify): refresh graph after issue 287 monitoring update"
```

If no generated files changed, skip this commit.

## Self-Review Checklist

- Spec coverage mapped:
  - Hardcoded 1GB removal -> Task 2
  - `usagePercent` RSS semantics -> Task 2 + Task 3
  - `rssUsagePercent` alias -> Task 1 + Task 2 + Task 3
  - `heapUsagePercent` supplementary metric -> Task 1 + Task 2
  - Guard/edge cases -> Task 3
  - Documentation/comments -> Task 2
  - Testing reinforcement -> Tasks 1-4
- Placeholder scan complete: no TBD/TODO/implicit steps.
- Type consistency check:
  - Uses `usagePercent`, `rssUsagePercent`, `heapUsagePercent` consistently.
  - `getMemoryMetrics()` return shape aligned with `PerformanceMetrics.memory`.
