# Issue #175 — Bootstrap verification & conditional assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm whether GitHub #175’s “monolithic `initializeServices`” finding still applies after Wave #214, document evidence, and only if triggers fire, thin `initializeServices` by moving the `ServerServices` object literal into a file-local `assembleServerServices` helper—without changing runtime behavior or the public `ServerServices` contract.

**Architecture:** Phase A is evidence-first (line counts + optional team static analyzer + repo gates). Phase B is optional and minimal: a **non-exported** `assembleServerServices` function in `bootstrap.ts` so the `try` block ends with a single `return assembleServerServices({ ... })` expression—avoiding circular imports.

**Tech Stack:** TypeScript 5.x, Node ≥24, Vitest, npm workspaces; paths under `packages/memento-core/src/bootstrap*.ts`.

**Spec:** `docs/superpowers/specs/2026-05-01-issue-175-bootstrap-verify-design.md`

**Note:** This is primarily verification. Phase B is behavior-preserving; verification remains `npm run lint`, `npm run type-check`, `npm test` (no new failing-test TDD requirement).

---

## File map

| Path | Responsibility |
|------|----------------|
| `packages/memento-core/src/bootstrap.ts` | `ServerServices`, `initializeServices`; Phase B adds **non-exported** `assembleServerServices` below the interface |
| GitHub issue #175 / PR description | Phase A numbers + Phase B decision trail |

---

### Task 1: Capture quantitative baseline (Phase A)

**Files:**

- Modify: GitHub issue #175 comment (or a short note under `docs/_work/` — pick **one** place and link it from the PR)

- [ ] **Step 1:** From the repository root, record line counts:

```bash
wc -l packages/memento-core/src/bootstrap.ts packages/memento-core/src/bootstrap/*.ts
```

Expected: `bootstrap.ts` is ~150 lines total; combined `bootstrap/*.ts` is a few hundred lines (exact numbers vary by commit).

- [ ] **Step 2:** Record how many source lines sit inside `initializeServices` (adjust range if the function moves):

```bash
sed -n '/export async function initializeServices/,/^}$/p' packages/memento-core/src/bootstrap.ts | wc -l
```

- [ ] **Step 3:** Paste outputs into the issue/PR note under `## Issue #175 Phase A — baseline (YYYY-MM-DD)`.

- [ ] **Step 4:** If you created `docs/_work/...`, commit:

```bash
git add docs/_work/<your-note>.md
git commit -m "docs: record bootstrap baseline for #175 Phase A"
```

---

### Task 2: Run repository quality gates (Phase A)

**Files:** none

- [ ] **Step 1:**

```bash
npm run lint
```

Expected: completes with **0 errors** (warnings may exist repo-wide).

- [ ] **Step 2:**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 3:**

```bash
npm test
```

Expected: all tests pass (same bar as `main`).

- [ ] **Step 4:** Copy pass/fail summaries into the Phase A note.

---

### Task 3: Optional static scan using the team’s #175 toolchain (Phase A)

**Files:** none

- [ ] **Step 1:** If your environment has the **same** analyzer that produced #175 (several internal docs mention `ai-slop-detector --js`; the public npm registry may not host it), run it against:

- `packages/memento-core/src/bootstrap.ts`
- `packages/memento-core/src/bootstrap/`

Example shape (replace with the exact executable your team uses):

```bash
<slop-or-complexity-tool> packages/memento-core/src/bootstrap.ts
```

- [ ] **Step 2:** If no tool is available, write explicitly in the Phase A note: `Static scan: unavailable in this environment; baseline uses wc + lint/type-check/test only.`

- [ ] **Step 3:** If a tool **did** run, record **file**, **function**, and **score/threshold** for `initializeServices` and any helper still flagged.

---

### Task 4: Decide whether Phase B runs (gate)

**Files:** none (decision only)

- [ ] **Step 1:** Implement Phase B only if **either**:

  - the static tool still flags `initializeServices` above team threshold, **or**
  - reviewers agree the large object literal harms readability enough to warrant extraction.

- [ ] **Step 2:** Record the decision in the PR description:

`Phase B: SKIP — <reason>` **or** `Phase B: EXECUTE — <reason>`.

- [ ] **Step 3:** If **SKIP**, finish after Task 6 without editing `bootstrap.ts` for assembly.

---

### Task 5 (Phase B only): Inline assembly helper in `bootstrap.ts`

**Files:**

- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Immediately **above** `export async function initializeServices`, add:

```typescript
function assembleServerServices(parts: ServerServices): ServerServices {
  return parts;
}
```

Do **not** export this symbol unless a follow-up issue explicitly needs it—keeping it file-private avoids expanding the package API.

- [ ] **Step 2:** Replace the existing `return { ... };` inside `initializeServices` with:

```typescript
    return assembleServerServices({
      searchEngine,
      hybridSearchEngine,
      vectorSearchEngine,
      embeddingService,
      forgettingPolicyService,
      performanceMonitor,
      databaseOptimizer,
      errorLoggingService,
      performanceAlertService,
      consolidationScoreService,
      writeCoalescingManager,
      metaMemoryService,
      anchorManager,
      relationGraph,
      failureDetector,
      reflexionWorker,
      walCheckpointScheduler,
      databaseLockMonitor,
      batchScheduler,
      introspectionScanCache,
      sleepConsolidationService,
      telemetryService,
      runtimeDiagnosticsLogger,
      runtimeDiagnosticsSamplerCleanup,
    });
```

- [ ] **Step 3:**

```bash
npm run type-check && npm test
```

Expected: PASS.

- [ ] **Step 4:** Commit:

```bash
git add packages/memento-core/src/bootstrap.ts
git commit -m "refactor(core): assembleServerServices helper for #175 Phase B"
```

---

### Task 6: Close the loop in GitHub + PR hygiene

**Files:** PR description only

- [ ] **Step 1:** Ensure PR lists:

  - Phase A metrics + gate commands outcome
  - Phase B decision + rationale
  - Link to spec `2026-05-01-issue-175-bootstrap-verify-design.md`

- [ ] **Step 2:** If Phase B skipped and metrics show #175 is stale, comment on #175:

`Verified on <commit>: initializeServices is orchestration-only post-#214; closing criteria met.`

---

## Plan self-review (author checklist)

1. **Spec coverage:** Design §4.1–§4.2 map to Tasks 1–5; §6 maps to Task 2; §5 preserves the existing `try/catch` wrapper (Task 5 does not touch it); §7 maps to Task 6.
2. **Placeholders:** No `TBD` steps; Phase B includes concrete code.
3. **Type consistency:** Property list matches the current `bootstrap.ts` return object keys; optional fields remain optional on `ServerServices`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-issue-175-bootstrap-verify.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — run tasks sequentially in one session with checkpoints.

Which approach do you want for implementation?

