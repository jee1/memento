# Issue #216 Wave 3 — Production `any` reduction (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove or replace meaningful `any` usage in the five highest-priority non-test TypeScript modules under `packages/memento-core`, without behavior or schema changes, and keep `npm run lint`, `npm run type-check`, and `npm test` green.

**Architecture:** Prioritize files using ESLint `@typescript-eslint/no-explicit-any` enabled **only on the CLI** (the repo root `.eslintrc.json` has this rule set to `"off"`, so `npm run lint` alone does not rank `any`). Then tighten types per file using `unknown` + guards, `z.infer` for Zod schemas, concrete generics (`CacheService<unknown>` / row DTOs), and `better-sqlite3` `Database` types where the value is an SQLite handle.

**Tech stack:** TypeScript 5.x, ESLint 8.x, Vitest, `better-sqlite3`, existing Zod tool schemas in `packages/memento-core`.

**Spec:** [`docs/superpowers/specs/2026-05-01-issue-216-wave3-any-production-design.md`](../specs/2026-05-01-issue-216-wave3-any-production-design.md)

---

## File map (PR1 — K = 5)

| Order | Path | Approx. `no-explicit-any` hits (2026-05-01 baseline) |
|-------|------|----------------------------------|
| 1 | `packages/memento-core/src/infrastructure/async-optimizer.ts` | 22 |
| 2 | `packages/memento-core/src/infrastructure/cache/cache-service.ts` | 11 |
| 3 | `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts` | 10 |
| 4 | `packages/memento-core/src/domains/forgetting/factories/spaced-repetition.factory.ts` | 9 |
| 5 | `packages/memento-core/src/domains/memory/tools/unpin-tool.ts` | 8 |

If `main` moved and Wave 1/2 touch one of these paths, **re-run Task 1** and swap files per the design doc conflict rule.

---

### Task 1: Lock prioritization (ESLint JSON + aggregation)

**Files:**

- Read: `.eslintrc.json` (confirm `@typescript-eslint/no-explicit-any` is `"off"` — do **not** flip it in this PR unless explicitly scoped later)
- Create (optional helper): `scripts/list-explicit-any-core.mjs` — only if you prefer a checked-in script; otherwise keep commands inline below

- [ ] **Step 1: Run ESLint with explicit-any forced on, write JSON**

```bash
cd "$(git rev-parse --show-toplevel)"
OUT="/tmp/memento-eslint-any-core.json"
npx eslint "packages/memento-core/src/**/*.ts" \
  --ignore-pattern "**/*.spec.ts" \
  --ignore-pattern "**/test/**" \
  --no-error-on-unmatched-pattern \
  --rule "@typescript-eslint/no-explicit-any: error" \
  -f json -o "$OUT" || true
```

Expected: file `$OUT` exists (ESLint exits non-zero when problems exist — that is OK).

- [ ] **Step 2: Aggregate per-file counts (top 8)**

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('/tmp/memento-eslint-any-core.json', 'utf8'));
const rows = [];
for (const file of data) {
  const n = (file.messages ?? []).filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any').length;
  if (n) rows.push([n, file.filePath]);
}
rows.sort((a, b) => b[0] - a[0]);
for (const [n, p] of rows.slice(0, 8)) {
  console.log(String(n).padStart(3), p.replace(/.*packages\//, 'packages/'));
}
NODE
```

Expected: first five rows match the table in **File map** (or document the new top-5 in the PR description if the order changed).

- [ ] **Step 3: Commit (only if you added `scripts/list-explicit-any-core.mjs`)**

```bash
git add scripts/list-explicit-any-core.mjs
git commit -m "chore: add eslint helper to rank explicit-any in memento-core"
```

If no script was added, skip Step 3.

---

### Task 2: `async-optimizer.ts`

**Files:**

- Modify: `packages/memento-core/src/infrastructure/async-optimizer.ts`

- [ ] **Step 1: Baseline single-file ESLint (explicit-any)**

```bash
npx eslint packages/memento-core/src/infrastructure/async-optimizer.ts \
  --no-error-on-unmatched-pattern \
  --rule "@typescript-eslint/no-explicit-any: error" -f unix
```

Expected before fix: **22** `Unexpected any` lines (exit code 1).

- [ ] **Step 2: Add a small `unknown` helper for failed retry payloads** near the top of the file (after imports):

```typescript
function failedTaskDataToTaskFields(data: unknown): Pick<Task, 'type' | 'data' | 'priority' | 'createdAt' | 'maxRetries' | 'timeout'> {
  if (typeof data !== 'object' || data === null) {
    return {
      type: 'unknown',
      data: {},
      priority: 0,
      createdAt: new Date(),
      maxRetries: 3,
      timeout: 30000
    };
  }
  const o = data as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : 'unknown';
  const dataField = o.data !== undefined ? o.data : {};
  const priority = typeof o.priority === 'number' ? o.priority : 0;
  const createdAt = o.createdAt instanceof Date ? o.createdAt : new Date();
  const maxRetries = typeof o.maxRetries === 'number' ? o.maxRetries : 3;
  const timeout = typeof o.timeout === 'number' ? o.timeout : 30000;
  return { type, data: dataField as Task['data'], priority, createdAt, maxRetries, timeout };
}
```

- [ ] **Step 3: Replace `retryTask` body** so `originalTask` uses `failedTaskDataToTaskFields(failedResult.data)` instead of six `(failedResult.data as any)?....` expressions.

- [ ] **Step 4: Replace `executeTask` return type** — change `private async executeTask(): Promise<any>` to `Promise<unknown>` (or a discriminated union of the six return shapes if you prefer stricter typing without widening callers).

- [ ] **Step 5: Introduce typed payloads for memory / failure_event**

Add interfaces above `AsyncTaskWorker` (names illustrative — align field names with real `this.task.data` usage):

```typescript
interface MemoryOperationTaskData {
  operation: string;
  content?: string;
  type?: string;
  tags?: string[];
  importance?: number;
}

interface FailureEventTaskData {
  event: { id: string; [key: string]: unknown };
  handler: (event: { id: string; [key: string]: unknown }) => Promise<void>;
}
```

In `processMemoryOperation`, replace `this.task.data as any` with:

```typescript
const raw = this.task.data;
if (typeof raw !== 'object' || raw === null) throw new Error('Invalid memory_operation payload');
const { operation, content, type, tags, importance } = raw as MemoryOperationTaskData;
```

In `processFailureEvent`, type `this.task.data` as `FailureEventTaskData` after `typeof` / `handler` checks (keep runtime checks already present).

- [ ] **Step 6: Replace `Promise<any>` processors** (`processEmbedding`, `processSearch`, `processCleanup`, `processBatchInsert`, `processFailureEvent`) with `Promise<Record<string, unknown>>` or narrower literal return types matching each `return { ... }`.

- [ ] **Step 7: `BatchProcessor` maps**

Change `Map<string, any[]>` to `Map<string, unknown[]>` (or `Map<string, Task[]>` if all batches are tasks — pick the type that matches `addToBatch<T>` usage). Update `processMemoryBatch(items: unknown[])` etc. Replace `Record<string, any>` in `getBatchStats` with `Record<string, { size: number; lastFlush: Date }>` to match the declared return type.

- [ ] **Step 8: Re-run single-file ESLint**

Expected: **0** `no-explicit-any` messages for this file.

- [ ] **Step 9: Commit**

```bash
git add packages/memento-core/src/infrastructure/async-optimizer.ts
git commit -m "refactor(core): tighten types in async-optimizer (Wave 3)"
```

---

### Task 3: `cache-service.ts`

**Files:**

- Modify: `packages/memento-core/src/infrastructure/cache/cache-service.ts`

- [ ] **Step 1: Baseline ESLint count**

```bash
npx eslint packages/memento-core/src/infrastructure/cache/cache-service.ts \
  --rule "@typescript-eslint/no-explicit-any: error" -f unix
```

Expected before fix: **11** problems.

- [ ] **Step 2: Default generic** — `export class CacheService<T = any>` → `export class CacheService<T = unknown>` (or `T = undefined` if that fits callers better after type-check).

- [ ] **Step 3: Search-result cache typing** — Define a narrow row type used only for search cache entries, e.g.:

```typescript
export interface CachedSearchHit {
  id: string;
  content: string;
  score?: number;
  [key: string]: unknown;
}
```

Replace `generateSearchKey(query: string, filters?: any, ...)` with `filters?: Record<string, unknown>` (or a dedicated `SearchFilters` interface if one already exists in this module — reuse before inventing).

Replace `getSearchResults(...): any[] | null` with `CachedSearchHit[] | null`. Replace `results: any[]` parameters with `CachedSearchHit[]`. Replace `_filters?: any` with `Record<string, unknown> | undefined`.

- [ ] **Step 4: `SearchCacheManager` internal `CacheService<any[]>`** — use `CacheService<CachedSearchHit[]>` (or `unknown[]` if hits are heterogeneous) consistently for `this.cache`.

- [ ] **Step 5: ESLint + type-check slice**

```bash
npx eslint packages/memento-core/src/infrastructure/cache/cache-service.ts --rule "@typescript-eslint/no-explicit-any: error"
npm run type-check
```

Expected: ESLint clean for this file; type-check passes.

- [ ] **Step 6: Commit**

```bash
git add packages/memento-core/src/infrastructure/cache/cache-service.ts
git commit -m "refactor(core): replace any in cache-service (Wave 3)"
```

---

### Task 4: `memory-embedding-service.ts`

**Files:**

- Modify: `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts`

- [ ] **Step 1: Baseline ESLint**

```bash
npx eslint packages/memento-core/src/domains/memory/services/memory-embedding-service.ts \
  --rule "@typescript-eslint/no-explicit-any: error" -f unix
```

Expected: **10** problems (mostly `db: any`, `global as any`, `row: any`).

- [ ] **Step 2: Import SQLite database type**

At top of file add:

```typescript
import type { Database } from 'better-sqlite3';
```

Replace every `db: any` parameter with `db: Database`.

- [ ] **Step 3: Global warning flag without `any`**

Replace `(global as any).__vecExtensionLoadWarningShown` with:

```typescript
const g = globalThis as typeof globalThis & { __vecExtensionLoadWarningShown?: boolean };
if (!g.__vecExtensionLoadWarningShown) {
  // ...
  g.__vecExtensionLoadWarningShown = true;
}
```

- [ ] **Step 4: Query row mapping** — For `(row: any)` in `similarities.map`, define a minimal interface for the SQL row (fields you read), e.g. `interface SimilarityRow { id: string; content: string; ... }`, then `similarities.map((row: SimilarityRow) => ({ ... }))`. If the query is untyped, cast once: `const row = raw as SimilarityRow` **after** documenting expected columns in a one-line comment.

- [ ] **Step 5: Provider stats row** — Same pattern for `providerStats.map((row: any) => ...)`.

- [ ] **Step 6: ESLint file + full tests**

```bash
npx eslint packages/memento-core/src/domains/memory/services/memory-embedding-service.ts --rule "@typescript-eslint/no-explicit-any: error"
npm test
```

- [ ] **Step 7: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-embedding-service.ts
git commit -m "refactor(core): type sqlite db and rows in memory-embedding-service (Wave 3)"
```

---

### Task 5: `spaced-repetition.factory.ts`

**Files:**

- Modify: `packages/memento-core/src/domains/forgetting/factories/spaced-repetition.factory.ts`

- [ ] **Step 1: Baseline ESLint**

Expected: **9** `any` usages on algorithm helper methods.

- [ ] **Step 2: Define feature vectors as `Record<string, number>`** (or a named `SpacedRepetitionFeatures` interface matching real callers — inspect call sites before locking fields):

```bash
rg "calculateNextInterval\(" packages/memento-core/src -g "*.ts"
```

Replace `features: any` with `features: Record<string, number>` **only if** all call sites pass numeric maps; otherwise use `Record<string, unknown>` and narrow where read.

- [ ] **Step 3: Return types** — Replace `createReviewSchedule(...): any` with a concrete interface `ReviewSchedule` declared in this file (fields used by downstream code). Replace `any[]` with `ReviewSchedule[]`. For `analyzeReviewPerformance(schedules: any[], ...)`, use `ReviewSchedule[]`.

- [ ] **Step 4: `calculateReviewPriority(schedule: any)`** → `schedule: ReviewSchedule`.

- [ ] **Step 5: ESLint + targeted tests**

```bash
npx eslint packages/memento-core/src/domains/forgetting/factories/spaced-repetition.factory.ts --rule "@typescript-eslint/no-explicit-any: error"
npm run test -w @memento/core -- --run packages/memento-core/src/domains/forgetting
```

(Adjust the Vitest filter if the package script differs — goal: run forgetting-related specs.)

- [ ] **Step 6: Commit**

```bash
git add packages/memento-core/src/domains/forgetting/factories/spaced-repetition.factory.ts
git commit -m "refactor(core): add types to spaced-repetition factory helpers (Wave 3)"
```

---

### Task 6: `unpin-tool.ts`

**Files:**

- Modify: `packages/memento-core/src/domains/memory/tools/unpin-tool.ts`

- [ ] **Step 1: Baseline ESLint** — expect **8** hits.

- [ ] **Step 2: `handle` params** — After `UnpinSchema` definition, add:

```typescript
type UnpinParams = z.infer<typeof UnpinSchema>;
```

Change signature to:

```typescript
async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
  const { id, reason, batch, confirm = false } = UnpinSchema.parse(params);
```

(If `UnpinParams` is unused after parse, omit the type alias and keep only `unknown` — either is fine for lint.)

- [ ] **Step 3: SQLite busy check** — Replace `(error as any).code` with:

```typescript
function isSqliteBusy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'SQLITE_BUSY';
}
```

Use `isSqliteBusy(error)` in the catch path.

- [ ] **Step 4: Memory row types** — Replace `Promise<any>` / `Promise<Map<string, any>>` / `Promise<any[]>` with the concrete repository/DTO types already used elsewhere for memory rows (search `CoreMemory` / `MemoryRecord` in `packages/memento-core/src/domains/memory` — **import the existing interface** instead of inventing a duplicate). If only a partial shape is needed, define `interface UnpinMemoryRow { id: string; pinned: boolean; ... }` local to this tool.

- [ ] **Step 5: Remove `as any[]`** on line ~220 — parse with Zod `z.array(z.unknown())` or a stricter schema matching the SQL result.

- [ ] **Step 6: ESLint + tool spec**

```bash
npx eslint packages/memento-core/src/domains/memory/tools/unpin-tool.ts --rule "@typescript-eslint/no-explicit-any: error"
npm run test -w @memento/core -- --run packages/memento-core/src/domains/memory/tools/__tests__/unpin-tool.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/memento-core/src/domains/memory/tools/unpin-tool.ts
git commit -m "refactor(core): remove any from unpin-tool (Wave 3)"
```

---

### Task 7: Repo-wide quality gates + PR text

- [ ] **Step 1: Full gates**

```bash
npm run lint
npm run type-check
npm test
```

Expected: all succeed (same as CI expectations for this repo).

- [ ] **Step 2: Optional explicit-any audit on the five files**

```bash
for f in \
  packages/memento-core/src/infrastructure/async-optimizer.ts \
  packages/memento-core/src/infrastructure/cache/cache-service.ts \
  packages/memento-core/src/domains/memory/services/memory-embedding-service.ts \
  packages/memento-core/src/domains/forgetting/factories/spaced-repetition.factory.ts \
  packages/memento-core/src/domains/memory/tools/unpin-tool.ts; do
  npx eslint "$f" --rule "@typescript-eslint/no-explicit-any: error" || exit 1
done
```

Expected: **no output** and exit code 0.

- [ ] **Step 3: PR description** — Include bullets: linked spec, list of five files, note that ESLint config still leaves `no-explicit-any` off globally but Wave 3 uses CLI override for ranking and per-file verification. Use `Closes #216` and `Related #180`.

---

## Plan self-review (maintainer checklist)

1. **Spec coverage:** Prioritization (design §4) → Task 1. Scope / whitelist / exclude test + specs → Tasks 2–6 file choices + Task 7. Type strategies (design §5) → embedded in each task. **Gap addressed:** repo has `no-explicit-any` off in `.eslintrc.json`; plan documents CLI `--rule` instead of implying `npm run lint` lists `any` by default.
2. **Placeholder scan:** No `TBD` / vague “add validation” steps; each task ends with concrete commands.
3. **Type consistency:** `UnpinParams` / `Database` / `ReviewSchedule` names must match actual edits within each file—rename locally if the codebase already exports equivalent types.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-05-01-issue-216-wave3-any-production.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`.

2. **Inline execution** — Run tasks sequentially in one session with checkpoints. **REQUIRED SUB-SKILL:** `superpowers:executing-plans`.

**Which approach do you want for implementation?**
