# Monorepo Final Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the monorepo normalization by fixing test imports, verifying assets, removing redundant root src/, and performing final build/test verification.

**Architecture:** Surgical replacement of relative imports with workspace aliases (@memento/core, @memento/client) in moved tests. Cleanup of legacy root src/ directory.

**Tech Stack:** Node.js, TypeScript, Vitest, npm workspaces.

---

### Task 1: Fix Core Test Imports

**Files:**
- Modify: `packages/memento-core/src/test/**/*.ts`
- Modify: `packages/memento-core/src/test/**/*.spec.ts`

- [ ] **Step 1: Replace relative imports with @memento/core in packages/memento-core**
    - `../domains/` -> `@memento/core`
    - `../../domains/` -> `@memento/core`
    - `../shared/` -> `@memento/core`
    - `../../shared/` -> `@memento/core`
    - `../infrastructure/` -> `@memento/core`
    - `../../infrastructure/` -> `@memento/core`
    - `../services/` -> `@memento/core`
    - `../tools/` -> `@memento/core`
    - `../workers/` -> `@memento/core`

### Task 2: Fix Server Test Imports

**Files:**
- Modify: `packages/memento-server/src/test/**/*.ts`
- Modify: `packages/memento-server/src/test/**/*.spec.ts`

- [ ] **Step 1: Replace relative imports with @memento/core and @memento/client in packages/memento-server**
    - `../domains/` -> `@memento/core`
    - `../shared/` -> `@memento/core`
    - `../infrastructure/` -> `@memento/core`
    - `../services/` -> `@memento/core`
    - `../tools/` -> `@memento/core`
    - `../workers/` -> `@memento/core`
    - `../client/` -> `@memento/client` (if any)

### Task 3: Verify Asset Integration

**Files:**
- Read: `packages/memento-core/scripts/copy-assets.js`

- [ ] **Step 1: Check copy-assets.js for correctness**
    - Ensure it copies schema, migrations, prompts, and config to `dist/`.

### Task 4: Root src/ Cleanup

- [ ] **Step 1: Remove root src/ directory**
    - Run: `rm -rf src/`

### Task 5: Final Verification

- [ ] **Step 1: Run full build**
    - Run: `npm run build`
    - Expected: Success (exit 0)

- [ ] **Step 2: Run all tests**
    - Run: `npm test`
    - Expected: All tests pass.

### Task 6: Commit Changes

- [ ] **Step 1: Commit all cleanup changes**
    - Message: `refactor: final monorepo normalization and test import fixes`
