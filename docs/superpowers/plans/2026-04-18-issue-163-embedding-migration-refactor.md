# Issue #163 Embedding migration refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `EmbeddingMigrationService.execute()` and simplify `rollback()` in `packages/memento-core` to meet line-count, complexity, and nesting targets while preserving behavior; add a missing regression test for the zero-source-rows path.

**Architecture:** Phase 1 — same file: extract named `private` methods (`resolveEffectiveMonitor`, statement builders or a single `prepareMigrationStatements`, `processMigrationRow` / batch driver, `finalizeMigrationRun` with auto-rollback + history). Replace the anonymous `processBatch` with calls to `processMigrationRow`. Refactor `rollback` with small helpers for delete vs restore. Phase 2 — only if any method still exceeds ~50 lines or complexity > 15 or nesting > 5: move the oversized block to a colocated helper module (e.g. `embedding-migration-execute-helpers.ts`).

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing `vectorCompatibilityService` / `migrationHistoryService` / `migrationMonitorService`.

**Spec:** `docs/superpowers/specs/2026-04-18-issue-163-embedding-migration-refactor-design.md`

**Worktree (recommended):** Branch `issue/163-embedding-migration-refactor` at `.worktrees/issue-163-embedding-migration-refactor/`.

---

## File map

| File | Action |
|------|--------|
| `packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts` | Refactor `execute`, `rollback`; add `private` methods; optionally new interfaces for statement bundle |
| `packages/memento-core/src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts` | Add zero-source-rows test |
| `packages/memento-core/src/domains/embedding/services/embedding-migration-execute-helpers.ts` | **Only if Phase 2** — pure functions or class holding batch row processing |

---

### Task 1: Regression test — no source rows

**Files:**
- Modify: `packages/memento-core/src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts`

- [ ] **Step 1: Add test case**

Insert after the `creates a basic migration plan with defaults` test (after line ~87), a new `it` block:

```typescript
  it('returns success immediately when no rows exist for the source provider', async () => {
    const plan = embeddingMigrationService.createPlan('minilm', 'openai');
    const result = await embeddingMigrationService.execute(db, plan);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.rollbackEntries).toHaveLength(0);
    expect(result.rolledBack).toBe(false);
    expect(result.nextResumeFromId).toBe(plan.resumeFromId ?? undefined);

    const historyCount = db.prepare('SELECT COUNT(*) AS cnt FROM migration_history').get() as { cnt: number };
    expect(historyCount.cnt).toBe(0);
  });
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
cd packages/memento-core && npx vitest run src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts
```

Expected: all tests PASS (including the new one).

- [ ] **Step 3: Commit**

```bash
git add packages/memento-core/src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts
git commit -m "test(embedding): cover execute when source provider has no rows — 이슈 #163"
```

---

### Task 2: Extract `resolveEffectiveMonitor` and early-return path clarity

**Files:**
- Modify: `packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts`

- [ ] **Step 1: Add private method**

Add:

```typescript
  private resolveEffectiveMonitor(monitor: MigrationMonitorOptions): MigrationMonitorOptions {
    return monitor.runId && !monitor.reporter
      ? { ...monitor, reporter: migrationMonitorService }
      : monitor;
  }
```

- [ ] **Step 2: Use it in `execute`**

Replace the inline `effectiveMonitor` ternary at the start of `execute` with:

```typescript
    const effectiveMonitor = this.resolveEffectiveMonitor(monitor);
```

- [ ] **Step 3: Run tests**

```bash
cd packages/memento-core && npx vitest run src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts
git commit -m "refactor(embedding): extract resolveEffectiveMonitor — 이슈 #163"
```

---

### Task 3: Extract row processing — replace anonymous `processBatch`

**Files:**
- Modify: `packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts`

- [ ] **Step 1: Introduce a private `processMigrationRow` (or equivalent name)**

Move the **per-row** logic from inside the `processBatch` closure (lines ~303–383: loop body only, not the `for` wrapper) into:

```typescript
  private processMigrationRow(params: {
    row: RawEmbeddingRow;
    plan: EmbeddingMigrationPlan;
    normalizationMode: VectorNormalization;
    existingStatement: ReturnType<Database['prepare']>;
    upsertStatement: ReturnType<Database['prepare']>;
    progress: MigrationProgress;
    errors: EmbeddingMigrationError[];
    rollbackEntries: MigrationRollbackEntry[];
    reportEvery: number;
    effectiveMonitor: MigrationMonitorOptions;
  }): void
```

Implement the same try / catch / finally as today: increment `processed`, set `lastMemoryId`, parse embedding, `vectorCompatibilityService.assessProviderCompatibility`, conditional upsert + rollback entry push, `succeeded++` or `failed++` + error push, `finally` with `updatedAt` and periodic `notifyProgress`.

Use early `continue` is not applicable inside a method — keep control flow identical (no behavior change).

- [ ] **Step 2: Replace `processBatch`**

Implement `processBatch` as:

```typescript
    const processBatch = (batch: RawEmbeddingRow[]): void => {
      for (const row of batch) {
        this.processMigrationRow({
          row,
          plan,
          normalizationMode,
          existingStatement,
          upsertStatement,
          progress,
          errors,
          rollbackEntries,
          reportEvery,
          effectiveMonitor
        });
      }
    };
```

Or inline the `for` loop in the `while` without a nested arrow — either is fine if nesting depth ≤ 5.

- [ ] **Step 3: Run tests**

```bash
cd packages/memento-core && npx vitest run src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(embedding): extract processMigrationRow from execute — 이슈 #163"
```

---

### Task 4: Extract batch loop and/or finalization

**Files:**
- Modify: `packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts`

- [ ] **Step 1: Extract `runMigrationBatches`** (name flexible)

Move the `while (true) { ... }` block (select batch, break if empty, process, update `lastProcessedId`, `notifyProgress`) into `private runMigrationBatches(...)` with parameters: `db`, `plan`, `selectStatement`, `processBatch` or row processor, `progress`, `lastProcessedId` ref (return updated cursor), `effectiveMonitor`.

Alternatively keep a thin `while` in `execute` if extraction does not reduce complexity — goal is **shorter `execute`** and **metrics**, not a fixed number of methods.

- [ ] **Step 2: Extract `finalizeExecute`**

Move from `const endTime = new Date()` through `recordHistory` (exclusive of early returns) into `private finalizeMigrationExecute(...)` returning `MigrationResult`, including: `completeStep`, `notifyProgress`, conditional `rollback` on failure, building `result`, `recordHistory` when `!plan.dryRun`.

- [ ] **Step 3: Run tests**

```bash
cd packages/memento-core && npx vitest run src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(embedding): split batch loop and finalize path in execute — 이슈 #163"
```

---

### Task 5: Refactor `rollback`

**Files:**
- Modify: `packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts`

- [ ] **Step 1: Add `private applyRollbackDelete` / `private applyRollbackRestore`** (or one `applyRollbackEntry`)

Split the `for` loop body so `rollback` only iterates and delegates. Keep `DELETE` and `INSERT ... ON CONFLICT` SQL in prepared statements as today.

- [ ] **Step 2: Run tests**

```bash
cd packages/memento-core && npx vitest run src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(embedding): simplify rollback via private helpers — 이슈 #163"
```

---

### Task 6: Quality gate — full package

**Files:**
- (none new unless Phase 2)

- [ ] **Step 1: Lint and type-check**

```bash
npm run lint
npm run type-check
```

Expected: no errors.

- [ ] **Step 2: Full memento-core tests**

```bash
npm test --workspace packages/memento-core
```

Expected: PASS.

- [ ] **Step 3: Optional — slop-detector / complexity**

Re-run the same tooling used in issue #163. Confirm: `execute` chunks ≤ ~50 lines, complexity ≤ 15 per method, nesting ≤ 5. If any method fails: **Task 7 (Phase 2)**.

- [ ] **Step 4: Commit** (only if formatting or eslint fixes)

---

### Task 7 (conditional): Phase 2 — helper module

**Only if** Task 6 metrics fail after Task 5.

**Files:**
- Create: `packages/memento-core/src/domains/embedding/services/embedding-migration-execute-helpers.ts`
- Modify: `embedding-migration-service.ts` — import and delegate the oversized block only.

- [ ] **Step 1:** Move the smallest failing unit (usually row processing or statement preparation) into the helper file with explicit types from `migration.types.ts`.

- [ ] **Step 2:** Run `npm test --workspace packages/memento-core` and `npm run lint`.

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(embedding): extract helpers for migration execute — 이슈 #163"
```

---

## Plan self-review (spec coverage)

| Spec section | Tasks |
|--------------|-------|
| 동작 동일 | All tasks preserve logic by move-only refactors; tests gate |
| 수치 목표 | Task 6 + optional Task 7 |
| 테스트 보강 (zero rows) | Task 1 |
| 2단계 파일 분리 | Task 7 conditional |
| rollback 단순화 | Task 5 |

Placeholder scan: none.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-issue-163-embedding-migration-refactor.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — Run tasks in this session using executing-plans with checkpoints.

**Which approach?**
