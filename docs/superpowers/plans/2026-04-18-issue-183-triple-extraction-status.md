# Issue #183 — Triple extraction status (`''` 고착) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix production path so `remember-tool` triple extraction never leaves `triple_extracted_status` stuck as empty string `''`; stabilize `remember-tool.spec.ts` AriGraph test.

**Architecture:** Expand the SQL `WHERE` on the `in_progress` claim `UPDATE` in `remember-tool.ts` so `NULL` and `''` are both treated as “unset” for claiming the job, matching `triple-extraction-batch-job` semantics. Add tests only if flakes remain after the one-line SQL fix.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing `DatabaseUtils.run` / `remember-tool` job queue.

**Spec:** [2026-04-18-issue-183-triple-extraction-status-design.md](../specs/2026-04-18-issue-183-triple-extraction-status-design.md)

---

## File map

| File | Role |
|------|------|
| `packages/memento-core/src/domains/memory/tools/remember-tool.ts` | Triple extraction job: `in_progress` claim `UPDATE` — **modify `WHERE`** |
| `packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts` | AriGraph / triple extraction tests — **optional** tweak after primary fix |
| `docs/superpowers/specs/2026-04-18-issue-183-triple-extraction-status-design.md` | Design reference (already written) |

---

### Task 1: Claim `UPDATE` — treat `''` like `NULL`

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/remember-tool.ts` (inside `tripleExtractionJob`, the block that sets `triple_extracted_status` to `'in_progress'`)

- [ ] **Step 1: Locate the claim query**

Search for:

```ts
WHERE id = ? AND triple_extracted_status IS NULL
```

in `remember-tool.ts` (only occurrence in this file).

- [ ] **Step 2: Replace `WHERE` with NULL-or-empty semantics**

Change the SQL string so the claim applies when status is unset **or** empty string:

```ts
const statusResult = DatabaseUtils.run(dbRef, `
  UPDATE memory_item SET
    triple_extracted_status = ?,
    triple_extraction_metadata = ?
  WHERE id = ? AND (triple_extracted_status IS NULL OR triple_extracted_status = '')
`, [
  'in_progress',
  JSON.stringify({
    started_at: new Date().toISOString()
  }),
  savedMemoryId
]);
```

Keep the surrounding `if (statusResult.changes === 0)` logic unchanged.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
cd /home/jee1lee/git/memento
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts
```

Expected: all tests in file **PASS** (no new failures).

- [ ] **Step 4: Run quality gates**

```bash
npm run lint
npm run type-check
npm test
```

Expected: **PASS** (or same baseline if unrelated skips in CI).

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/memory/tools/remember-tool.ts
git commit -m "fix(memory): claim triple extraction when status is empty string

SQLite treats '' differently from NULL; the in_progress UPDATE matched 0 rows
and skipped extraction, leaving triple_extracted_status stuck as ''.

Aligns with triple-extraction-batch-job treating '' as pending.

Refs: https://github.com/jee1/memento/issues/183"
```

---

### Task 2 (conditional): Test-only hardening — only if Task 1 leaves flakes

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts` (AriGraph test polling block ~1706–1760)

- [ ] **Step 1: Re-run full suite 3× locally**

If `remember-tool` AriGraph test still flakes, proceed; otherwise **skip Task 2**.

- [ ] **Step 2: Optional — treat `in_progress` in poll condition**

If the flake is “stuck on `in_progress`”, extend the wait loop break condition to continue polling while status is `in_progress` (already implied — only break on `success`/`failed`). If needed, **increase** `maxWaitCount` slightly (e.g. 100 → 150) with a one-line comment referencing issue 183.

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts
npm test
```

```bash
git add packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts
git commit -m "test(memory): stabilize triple extraction wait for issue 183"
```

---

### Task 3: Issue verification command (manual)

- [ ] From repo root, with API keys as in issue #183:

```bash
set -a && source /home/jee1lee/git/memento/.env && set +a && env HOME=/tmp/memento-home npm test
```

Expected: **0 failures** in full suite (allow known skips per project config).

---

## Plan self-review (spec coverage)

| Spec section | Task |
|--------------|------|
| §5.1 `in_progress` WHERE expansion | Task 1 |
| §5.2 test hardening | Task 2 (conditional) |
| §6 verification | Task 1 steps 3–4, Task 3 |

No TBD placeholders in executable steps above.
