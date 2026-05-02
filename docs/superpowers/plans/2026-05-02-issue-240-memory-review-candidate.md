# Issue #240 memory_review_candidate schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite table `memory_review_candidate` with FK, partial unique index on `pending` per `memory_id`, queue index, migration `33.0`, idempotent `ensureMemoryReviewCandidateSchema`, tests, and `@memento/core` export.

**Architecture:** Follow migrations `031`/`032` (TypeScript `Migration` class, idempotent `up`). Mirror DDL in `ensure-memory-review-candidate-schema.ts` like `ensure-meta-memory-stats-schema.ts`. Call ensure from `init.ts` after other ensures. Append same DDL to `schema.sql` for fresh installs.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, SQLite 3 partial indexes.

**Spec:** `docs/superpowers/specs/2026-05-02-issue-240-memory-review-candidate-design.md` (on branch `issue/240-memory-review-candidate` in worktree).

---

## File map

| File | Action |
|------|--------|
| `packages/memento-core/src/infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.ts` | Create |
| `packages/memento-core/src/infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.spec.ts` | Create |
| `packages/memento-core/src/shared/utils/ensure-memory-review-candidate-schema.ts` | Create |
| `packages/memento-core/src/infrastructure/database/database/init.ts` | Modify |
| `packages/memento-core/src/infrastructure/database/database/schema.sql` | Modify |
| `packages/memento-core/src/index.ts` | Modify |

---

### Task 1: Migration 033

**Files:** Create `033-memory-review-candidate-schema.ts` (class `MemoryReviewCandidateSchemaMigration`, `version = '33.0'`, `validateBefore` requires `memory_item`, `up` creates table + two indexes with existence checks, `validateAfter` verifies table and indexes, `down` drops indexes/table and version row).

### Task 2: Spec tests

**Files:** Create `033-memory-review-candidate-schema.spec.ts` — table creation, idempotent `up`, duplicate pending throws, reviewed+pending same `memory_id` allowed. Use `db.pragma('foreign_keys = ON')` in setup.

### Task 3: Ensure helper

**Files:** Create `ensure-memory-review-candidate-schema.ts` — early return if no `memory_item`; same DDL as migration with `IF NOT EXISTS`.

### Task 4: init + schema.sql + index export

**Files:** `init.ts` import and call `ensureMemoryReviewCandidateSchema`; `schema.sql` append table + indexes; `index.ts` export ensure.

**Verify:** `npm run type-check` and `npx vitest run packages/memento-core/src/infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.spec.ts`.

---

## Self-review

Spec sections (table, FK, partial unique, queue index, migration, ensure, init, tests, export) are all mapped above.

---

## Execution

Inline execution applied in agent session; primary git branch for PR: `issue/240-memory-review-candidate` (worktree).
