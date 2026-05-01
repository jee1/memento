# Issue 211 Design: GitHub Actions Node 24 Migration

## 1) Context and Goal

### Background
Issue #209 addressed release workflow `git 128` root cause and recurrence prevention; PR #210 merged. Node 20 deprecation warnings in Actions were intentionally deferred to this follow-up (issue #211).

### Problem
GitHub Actions continues to surface **Node 20 deprecation** warnings for JavaScript-based actions. The repository should run CI and release on a supported Node line and align declared engine policy with that line.

### Goal
- Move **all** workflows under `.github/workflows/` that use `actions/setup-node` to **Node 24**.
- Bump **official** `actions/*` (and other pinned third-party actions) to current **major** versions where appropriate, after release-note review.
- Remove Node 20 deprecation warnings from Actions logs.
- Document compatibility impact for contributors and consumers.

### Stakeholder decision (confirmed)
**Root `package.json` `engines.node`**: set to **`>=24.0.0`** so CI, documentation, and npm engine declaration stay aligned. Contributors on Node 20 must upgrade; installs with `engine-strict=true` will fail below 24 (expected).

## 2) Scope and Out-of-scope

### In-scope
| Area | Files / artifacts |
|------|---------------------|
| CI | `.github/workflows/ci.yml` — all jobs using `setup-node` |
| Release | `.github/workflows/release.yml` |
| Security | `.github/workflows/security-check.yml` |
| Relation engine | `.github/workflows/relation-engine.yml` |
| Engine declaration | Root `package.json` `engines.node` → `>=24.0.0` |
| Docs | `AGENTS.md`, `CLAUDE.md`, `DEVELOPMENT_RULES.md`, root `README.md` (and any other doc that states Node ≥ 20) — update to **Node ≥ 24** |

### Out-of-scope
- Dockerfile base image bump (unless already tracked elsewhere; not required to close #211).
- Changing application runtime behavior unrelated to CI/tooling.
- Renovate/dependabot policy changes (optional future work).

## 3) Approach Options and Selection

### Option A: Node version only
Change `node-version` to `24` everywhere; leave action majors as-is.

- Pros: Smallest diff.
- Cons: Leaves stale action majors; may miss security or compatibility fixes.

### Option B: Node 24 + action major audit (**Selected**)
Align Node to 24 **and** review each `uses:` pin against current major (Marketplace / release notes). Apply upgrades where safe.

- Pros: Matches issue checklist; reduces long-term warning debt.
- Cons: Requires reading changelogs for breaking changes (especially composite actions).

### Option C: Shared workflow / reusable workflow
Extract a reusable “setup-node-npm” workflow.

- Pros: Single place for Node version.
- Cons: Overkill for four files; YAML reuse limits; higher churn for this issue.

**Selection:** **Option B**, with optional top-level `env.NODE_VERSION: '24'` in each workflow (or duplicated `node-version: '24'` for clarity — implementer chooses minimal duplication).

## 4) Component Design (per workflow)

### 4.1 `ci.yml`
- Every `actions/setup-node@v4` step: `node-version: '24'` (or `${{ env.NODE_VERSION }}` if env block added).
- Confirm `actions/checkout@v4` / `actions/upload-artifact@v4` remain current majors or bump per audit.
- No change to job graph or env flags (`CI`, `SKIP_*`, etc.) unless Node 24 exposes a defect.

### 4.2 `release.yml`
- `Setup Node.js` step: `node-version: "24"` (consistent quoting with file style).
- Re-verify `softprops/action-gh-release` — upgrade to latest major if v2+ exists and changelog acceptable; otherwise document “v1 retained, reason: …” in implementation PR.

### 4.3 `security-check.yml`
- `setup-node`: Node 24.
- `actions/cache@v3` → evaluate **v4** (or current major) for alignment with Actions runtime.

### 4.4 `relation-engine.yml`
- `setup-node`: Node 24.
- Paths filters unchanged.

### 4.5 Root `engines` and workspaces
- Set `engines.node` to `>=24.0.0` at monorepo root (authoritative for `npm install` warnings).
- If individual workspace packages duplicate `engines`, align them in the same PR or file a follow-up — **prefer same PR** for consistency.

## 5) Verification and Risk

### Pre-merge
- Open PR; confirm **all** workflow runs green on GitHub-hosted runners.
- Optional local validation: `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` when running `act` or experimental local simulation (issue mentions); **do not** leave this env set in committed workflow unless product requirement says otherwise.

### Known risk: timing-sensitive tests
Local `npm test` on Node **v24** observed **one failure** in `packages/memento-core/src/test/test-sleep-consolidation-isolation.spec.ts` (SC-002 threshold: latency vs baseline). If CI reproduces:
- Treat as **blocking** for green CI; adjust test tolerance / warmup / isolation in the same PR or a tightly coupled follow-up commit before merging.

### Post-merge
- Confirm Actions logs show **no Node 20 deprecation** for migrated steps.

## 6) Documentation (completion criterion: “변경 영향”)

Add a short subsection (one of: `AGENTS.md` “Commands / environment”, `DEVELOPMENT_RULES.md` prerequisites, or `README.md` Contributing):

- **CI and supported dev Node:** 24+.
- **Breaking note for contributors:** Node 20 is no longer supported for development or strict installs.
- **npm consumers:** `engines` now requires Node 24+; document override only if team explicitly allows `engine-strict=false` (discouraged).

## 7) Completion Checklist (maps to issue #211)

- [ ] `ci.yml`: Node 24 + action majors reviewed.
- [ ] `release.yml`: Node 24 + action majors reviewed.
- [ ] `security-check.yml`: Node 24 + action majors reviewed.
- [ ] `relation-engine.yml`: Node 24 + action majors reviewed.
- [ ] Root `engines.node`: `>=24.0.0`.
- [ ] Docs updated: Node ≥ 24 everywhere previously stating ≥ 20.
- [ ] No Node 20 deprecation warnings in Actions for these workflows.
- [ ] Full CI green; timing test failure resolved if reproduced.
- [ ] Impact paragraph merged per section 6.

## 8) Next Step After Approval

Invoke **writing-plans** skill to produce `tasks.md`-style implementation steps (file edits order, PR description template, rollback note).

