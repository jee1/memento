# Issue #162 — `.slopconfig.yaml` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a root `.slopconfig.yaml` so `slop-detector --project . --js` skips dependency, build, coverage, and graphify artifacts per spec `docs/superpowers/specs/2026-05-01-issue-162-slopconfig-design.md`.

**Architecture:** Single configuration file at repository root; no application code changes. Verification is manual CLI plus optional `npm test` to confirm the repo still passes.

**Tech Stack:** `slop-detector` (ai-slop-detector) v4.x CLI, YAML config `version: "2.0"`.

---

## Files

| File | Action |
|------|--------|
| `.slopconfig.yaml` (repo root) | **Create** — `version` + `ignore` list per spec §3.1 |

No TypeScript, test, or CI file changes in scope.

---

### Task 1: Add `.slopconfig.yaml`

**Files:**
- Create: `.slopconfig.yaml`

- [ ] **Step 1: Create the config file**

Create `.slopconfig.yaml` at the repository root with exactly:

```yaml
version: "2.0"
ignore:
  - "**/coverage/**"
  - "graphify-out/**"
  - "**/.next/**"
  - "**/node_modules/**"
  - "**/dist/**"
  - "test-results/**"
  - ".nyc_output/**"
  - "**/.rpt2_cache/**"
  - "**/.rts2_cache_cjs/**"
  - "**/.rts2_cache_es/**"
  - "**/.rts2_cache_umd/**"
```

- [ ] **Step 2: Commit the config**

```bash
git add .slopconfig.yaml
git commit -m "chore: add .slopconfig.yaml to exclude build artifacts from slop scan"
```

---

### Task 2: Manual verification (slop-detector)

**Files:** none

- [ ] **Step 1: Run slop-detector from repo root**

```bash
cd "$(git rev-parse --show-toplevel)"
slop-detector --project . --js --config .slopconfig.yaml 2>&1 | head -80
```

**Expected:** Command completes without requiring edits; output should not be dominated by paths under `node_modules/`, `coverage/`, `graphify-out/`, or `**/.next/**` (exact UI varies by CLI version).

- [ ] **Step 2: (Optional) Compare without config**

```bash
slop-detector --project . --js --config /dev/null 2>&1 | head -20
```

Only if your CLI accepts a dummy config; if not, skip. Purpose: confirm config is being read when default discovery is ambiguous.

---

### Task 3: Regression — test suite

**Files:** none

- [ ] **Step 1: Run full tests**

```bash
npm test
```

**Expected:** All tests pass (same as baseline on `main`).

- [ ] **Step 2: Final commit** (only if you changed anything after Task 1; otherwise skip)

If no further changes, no commit.

---

### Task 4: Push / PR

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin chore/issue-162-slopconfig
```

Link PR to GitHub issue #162 in the description.

**Expected:** Remote branch exists; PR references #162.

---

## Spec coverage (self-review)

| Spec § | Task |
|--------|------|
| §2.1 root `.slopconfig.yaml` v2 | Task 1 |
| §3.1 ignore list | Task 1 YAML |
| §3.2 CLI verification | Task 2 |
| §2.2 no CI / no automated slop test | No tasks (explicit non-goals) |

No placeholders; paths match spec.
