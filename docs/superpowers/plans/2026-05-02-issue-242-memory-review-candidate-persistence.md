# Issue #242 memory review candidate persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@memento/core` persistence for `memory_review_candidate`: idempotent pending upsert, list/get, safe `pending → reviewed|dismissed|expired` transitions, `AppErrorContract`-compatible errors (404/409), review updates `memory_item.last_accessed` + `last_accessed_at`, Vitest coverage. No `memento-server` HTTP in this issue.

**Architecture:** Single domain service module (`memory-review-candidate-persistence-service.ts`) next to #241 selection service; shared types + small error class file; all entry points call `ensureMemoryReviewCandidateSchema`. SQLite transactions for `markReviewed` (candidate + memory touch). Upsert uses `SELECT pending id by memory_id` then `UPDATE` or `INSERT` (never second `pending` row).

**Tech Stack:** TypeScript (ESM), `better-sqlite3`, Vitest, `node:crypto` `randomUUID`, migrations `033-memory-review-candidate-schema`, `011-meta-memory-stats-schema` (reuse #241 test fixture pattern).

**Spec:** `docs/superpowers/specs/2026-05-02-issue-242-memory-review-candidate-persistence-design.md`

---

## File map

| File | Action |
|------|--------|
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence.types.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-error.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts` | Create |
| `packages/memento-core/src/index.ts` | Modify — export new public API + types + error |

---

## Shared test fixture (copy into spec `beforeEach`)

Use the same pattern as `memory-review-candidate-selection-service.spec.ts`: `Database(':memory:')`, `createBaseSchema` **extended** with `last_accessed_at TEXT` (and keep `last_accessed TIMESTAMP`), then `MetaMemoryStatsSchemaMigration().up`, `MemoryReviewCandidateSchemaMigration().up`, insert at least one `memory_item` row with fixed `content` + `importance` for invariant assertions.

Fixed clock string for `now` parameter: `'2026-06-01T12:00:00.000Z'`.

---

### Task 1: Types module

**Files:**

- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence.types.ts`

- [ ] **Step 1: Add types file**

```typescript
export type MemoryReviewCandidateStatus = 'pending' | 'reviewed' | 'dismissed' | 'expired';

/** DB row shape for `memory_review_candidate` */
export interface MemoryReviewCandidateRow {
  id: string;
  memory_id: string;
  status: MemoryReviewCandidateStatus;
  priority: number;
  reason: string;
  due_at: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  dismissed_at: string | null;
  metadata_json: string | null;
}

/** One pending upsert row (aligned with #241 selection output fields used by batch) */
export interface UpsertPendingMemoryReviewCandidateInput {
  memory_id: string;
  priority: number;
  reason: string;
  due_at: string;
  metadata_json?: string | null;
}

export interface UpsertPendingMemoryReviewCandidatesResult {
  inserted: number;
  updated: number;
}

export interface ListMemoryReviewCandidatesQuery {
  status?: MemoryReviewCandidateStatus;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence.types.ts
git commit -m "feat(core): add memory review candidate persistence types (#242)"
```

---

### Task 2: Domain error class

**Files:**

- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-error.ts`

- [ ] **Step 1: Add error module**

```typescript
import { ErrorCategory, type AppErrorContract } from '../../../shared/types/error-types.js';

export const MEMORY_REVIEW_CANDIDATE_NOT_FOUND = 'memory_review_candidate_not_found';
export const MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE = 'memory_review_candidate_not_actionable';

export class MemoryReviewCandidateError extends Error implements AppErrorContract {
  readonly code: string;
  readonly category = ErrorCategory.MEMORY;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'MemoryReviewCandidateError';
    this.code = code;
    this.statusCode = statusCode;
  }

  static notFound(id: string): MemoryReviewCandidateError {
    return new MemoryReviewCandidateError(
      `Memory review candidate not found: ${id}`,
      MEMORY_REVIEW_CANDIDATE_NOT_FOUND,
      404,
    );
  }

  static notActionable(id: string, status: string): MemoryReviewCandidateError {
    return new MemoryReviewCandidateError(
      `Memory review candidate is not actionable (id=${id}, status=${status})`,
      MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
      409,
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-error.ts
git commit -m "feat(core): add memory review candidate domain errors (#242)"
```

---

### Task 3: Upsert + result counts (TDD)

**Files:**

- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts` (start with only upsert + imports)
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts`

- [ ] **Step 1: Write failing tests** — upsert insert then upsert update same `memory_id`, assert `pending` row count stays 1 and `priority` changes

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
import { upsertPendingMemoryReviewCandidates } from './memory-review-candidate-persistence-service.js';

const NOW = '2026-06-01T12:00:00.000Z';

function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      last_accessed_at TEXT,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      project_id TEXT,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);
}

describe('memory-review-candidate-persistence upsert', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at)
      VALUES ('mem_a', 'semantic', 'hello', 0.9, 'private', '2020-01-01 00:00:00', 0, 0, NULL)
    `);
    db.exec(`
      INSERT INTO meta_memory_stats (
        memory_id, recall_count, success_count, failure_count,
        avg_confidence, last_recalled_at, created_at, updated_at
      ) VALUES (
        'mem_a', 1, 1, 0, 0.9, '2020-02-01 00:00:00', '2020-02-01 00:00:00', '2020-02-01 00:00:00'
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts pending on first upsert and updates same memory_id on second (idempotent)', () => {
    const first = upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 100, reason: 'r1', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    expect(first.inserted).toBe(1);
    expect(first.updated).toBe(0);

    const rows1 = db
      .prepare(`SELECT priority, reason FROM memory_review_candidate WHERE memory_id = 'mem_a'`)
      .all() as { priority: number; reason: string }[];
    expect(rows1).toHaveLength(1);
    expect(rows1[0].priority).toBe(100);

    const second = upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 200, reason: 'r2', due_at: '2026-08-01T00:00:00.000Z' }],
      NOW,
    );
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);

    const rows2 = db
      .prepare(`SELECT COUNT(*) as c FROM memory_review_candidate WHERE memory_id = 'mem_a' AND status = 'pending'`)
      .get() as { c: number };
    expect(rows2.c).toBe(1);
    const pr = db
      .prepare(`SELECT priority, reason FROM memory_review_candidate WHERE memory_id = 'mem_a'`)
      .get() as { priority: number; reason: string };
    expect(pr.priority).toBe(200);
    expect(pr.reason).toBe('r2');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (function missing)

```bash
cd /home/jee1lee/git/memento/.worktrees/issue-242-memory-review-persistence
npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts
```

Expected: FAIL (export not found or TS compile error).

- [ ] **Step 3: Implement `upsertPendingMemoryReviewCandidates`**

Create `memory-review-candidate-persistence-service.ts`:

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';
import type {
  UpsertPendingMemoryReviewCandidateInput,
  UpsertPendingMemoryReviewCandidatesResult,
} from './memory-review-candidate-persistence.types.js';

export function upsertPendingMemoryReviewCandidates(
  db: Database.Database,
  items: UpsertPendingMemoryReviewCandidateInput[],
  now: string,
): UpsertPendingMemoryReviewCandidatesResult {
  ensureMemoryReviewCandidateSchema(db);
  let inserted = 0;
  let updated = 0;

  const run = db.transaction(() => {
    const selectPending = db.prepare<{ id: string }, [string]>(
      `SELECT id FROM memory_review_candidate WHERE memory_id = ? AND status = 'pending'`,
    );
    const updatePending = db.prepare(
      `UPDATE memory_review_candidate SET
        priority = @priority,
        reason = @reason,
        due_at = @due_at,
        metadata_json = @metadata_json,
        updated_at = @updated_at
      WHERE id = @id`,
    );
    const insert = db.prepare(
      `INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at, metadata_json
      ) VALUES (
        @id, @memory_id, 'pending', @priority, @reason, @due_at, @created_at, @updated_at, @metadata_json
      )`,
    );

    for (const item of items) {
      const existing = selectPending.get(item.memory_id);
      if (existing) {
        updatePending.run({
          id: existing.id,
          priority: item.priority,
          reason: item.reason,
          due_at: item.due_at,
          metadata_json: item.metadata_json ?? null,
          updated_at: now,
        });
        updated += 1;
      } else {
        insert.run({
          id: randomUUID(),
          memory_id: item.memory_id,
          priority: item.priority,
          reason: item.reason,
          due_at: item.due_at,
          created_at: now,
          updated_at: now,
          metadata_json: item.metadata_json ?? null,
        });
        inserted += 1;
      }
    }
  });

  run();
  return { inserted, updated };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts
git commit -m "feat(core): idempotent pending upsert for memory review candidates (#242)"
```

---

### Task 4: `getMemoryReviewCandidateById` + `listMemoryReviewCandidates`

**Files:**

- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts`
- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts`

- [ ] **Step 1: Add failing tests** — after upsert one row, `getMemoryReviewCandidateById` returns row; `listMemoryReviewCandidates` with `{ status: 'pending' }` returns length 1

```typescript
import {
  upsertPendingMemoryReviewCandidates,
  getMemoryReviewCandidateById,
  listMemoryReviewCandidates,
} from './memory-review-candidate-persistence-service.js';

it('get and list return pending candidate', () => {
  upsertPendingMemoryReviewCandidates(
    db,
    [{ memory_id: 'mem_a', priority: 42, reason: 'x', due_at: '2026-07-01T00:00:00.000Z' }],
    NOW,
  );
  const rows = listMemoryReviewCandidates(db, { status: 'pending' });
  expect(rows).toHaveLength(1);
  const one = getMemoryReviewCandidateById(db, rows[0].id);
  expect(one?.memory_id).toBe('mem_a');
  expect(one?.status).toBe('pending');
});
```

- [ ] **Step 2: Run vitest — expect FAIL**

- [ ] **Step 3: Append to service file** — add `mapRow`, `getMemoryReviewCandidateById`, `listMemoryReviewCandidates` (import `MemoryReviewCandidateRow`, `ListMemoryReviewCandidatesQuery` from types)

```typescript
import type {
  MemoryReviewCandidateRow,
  ListMemoryReviewCandidatesQuery,
  UpsertPendingMemoryReviewCandidateInput,
  UpsertPendingMemoryReviewCandidatesResult,
} from './memory-review-candidate-persistence.types.js';

function mapRow(r: Record<string, unknown>): MemoryReviewCandidateRow {
  return {
    id: String(r.id),
    memory_id: String(r.memory_id),
    status: r.status as MemoryReviewCandidateRow['status'],
    priority: Number(r.priority),
    reason: String(r.reason),
    due_at: String(r.due_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    reviewed_at: r.reviewed_at == null ? null : String(r.reviewed_at),
    dismissed_at: r.dismissed_at == null ? null : String(r.dismissed_at),
    metadata_json: r.metadata_json == null ? null : String(r.metadata_json),
  };
}

export function getMemoryReviewCandidateById(
  db: Database.Database,
  id: string,
): MemoryReviewCandidateRow | null {
  ensureMemoryReviewCandidateSchema(db);
  const r = db.prepare(`SELECT * FROM memory_review_candidate WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? mapRow(r) : null;
}

export function listMemoryReviewCandidates(
  db: Database.Database,
  query: ListMemoryReviewCandidatesQuery = {},
): MemoryReviewCandidateRow[] {
  ensureMemoryReviewCandidateSchema(db);
  if (query.status) {
    return db
      .prepare(
        `SELECT * FROM memory_review_candidate WHERE status = ? ORDER BY priority DESC, due_at ASC`,
      )
      .all(query.status)
      .map((row) => mapRow(row as Record<string, unknown>));
  }
  return db
    .prepare(`SELECT * FROM memory_review_candidate ORDER BY priority DESC, due_at ASC`)
    .all()
    .map((row) => mapRow(row as Record<string, unknown>));
}
```

- [ ] **Step 4: Run vitest — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): list/get memory review candidates (#242)"
```

---

### Task 5: `markMemoryReviewCandidateReviewed` (transaction + memory touch)

**Files:**

- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts`
- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts`

- [ ] **Step 1: Add failing tests**

```typescript
import { markMemoryReviewCandidateReviewed } from './memory-review-candidate-persistence-service.js';
import {
  MemoryReviewCandidateError,
  MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
} from './memory-review-candidate-persistence-error.js';

it('markReviewed updates candidate and memory_item access timestamps', () => {
  upsertPendingMemoryReviewCandidates(
    db,
    [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
    NOW,
  );
  const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
  markMemoryReviewCandidateReviewed(db, row.id, NOW);

  const cand = getMemoryReviewCandidateById(db, row.id);
  expect(cand?.status).toBe('reviewed');
  expect(cand?.reviewed_at).toBe(NOW);

  const mem = db.prepare(`SELECT last_accessed_at FROM memory_item WHERE id = 'mem_a'`).get() as {
    last_accessed_at: string | null;
  };
  expect(mem.last_accessed_at).toBe(NOW);
});

it('second markReviewed throws not actionable', () => {
  upsertPendingMemoryReviewCandidates(
    db,
    [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
    NOW,
  );
  const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
  markMemoryReviewCandidateReviewed(db, row.id, NOW);
  expect(() => markMemoryReviewCandidateReviewed(db, row.id, NOW)).toThrow(MemoryReviewCandidateError);
  try {
    markMemoryReviewCandidateReviewed(db, row.id, NOW);
  } catch (e) {
    expect(e).toBeInstanceOf(MemoryReviewCandidateError);
    expect((e as MemoryReviewCandidateError).code).toBe(MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE);
    expect((e as MemoryReviewCandidateError).statusCode).toBe(409);
  }
});
```

- [ ] **Step 2: Run vitest — FAIL**

- [ ] **Step 3: Implement** (import `MemoryReviewCandidateError`)

```typescript
import { MemoryReviewCandidateError } from './memory-review-candidate-persistence-error.js';

export function markMemoryReviewCandidateReviewed(
  db: Database.Database,
  candidateId: string,
  now: string,
): void {
  ensureMemoryReviewCandidateSchema(db);
  const run = db.transaction(() => {
    const cur = db
      .prepare<{ status: string }, [string]>(`SELECT status FROM memory_review_candidate WHERE id = ?`)
      .get(candidateId);
    if (!cur) {
      throw MemoryReviewCandidateError.notFound(candidateId);
    }
    if (cur.status !== 'pending') {
      throw MemoryReviewCandidateError.notActionable(candidateId, cur.status);
    }
    const info = db
      .prepare(
        `UPDATE memory_review_candidate SET status = 'reviewed', reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(now, now, candidateId);
    if (info.changes === 0) {
      throw MemoryReviewCandidateError.notActionable(candidateId, cur.status);
    }
    const mem = db
      .prepare<{ memory_id: string }, [string]>(`SELECT memory_id FROM memory_review_candidate WHERE id = ?`)
      .get(candidateId);
    if (!mem) throw MemoryReviewCandidateError.notFound(candidateId);
    db.prepare(
      `UPDATE memory_item SET last_accessed = CURRENT_TIMESTAMP, last_accessed_at = ? WHERE id = ?`,
    ).run(now, mem.memory_id);
  });
  run();
}
```

- [ ] **Step 4: Run vitest — PASS**

- [ ] **Step 5: Commit** `feat(core): mark memory review candidate reviewed (#242)`

---

### Task 6: `markMemoryReviewCandidateDismissed` + invariants

**Files:**

- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts`
- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts`

- [ ] **Step 1: Add failing test**

```typescript
import { markMemoryReviewCandidateDismissed } from './memory-review-candidate-persistence-service.js';

it('dismiss updates only candidate row', () => {
  upsertPendingMemoryReviewCandidates(
    db,
    [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
    NOW,
  );
  const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
  const before = db.prepare(`SELECT content, importance FROM memory_item WHERE id = 'mem_a'`).get() as {
    content: string;
    importance: number;
  };
  markMemoryReviewCandidateDismissed(db, row.id, NOW);
  const after = db.prepare(`SELECT content, importance FROM memory_item WHERE id = 'mem_a'`).get() as {
    content: string;
    importance: number;
  };
  expect(after).toEqual(before);
  expect(getMemoryReviewCandidateById(db, row.id)?.status).toBe('dismissed');
});
```

- [ ] **Step 2: FAIL → Step 3: Implement** (mirror `markReviewed` but no `memory_item` update)

```typescript
export function markMemoryReviewCandidateDismissed(
  db: Database.Database,
  candidateId: string,
  now: string,
): void {
  ensureMemoryReviewCandidateSchema(db);
  const run = db.transaction(() => {
    const cur = db
      .prepare<{ status: string }, [string]>(`SELECT status FROM memory_review_candidate WHERE id = ?`)
      .get(candidateId);
    if (!cur) throw MemoryReviewCandidateError.notFound(candidateId);
    if (cur.status !== 'pending') {
      throw MemoryReviewCandidateError.notActionable(candidateId, cur.status);
    }
    const info = db
      .prepare(
        `UPDATE memory_review_candidate SET status = 'dismissed', dismissed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(now, now, candidateId);
    if (info.changes === 0) {
      throw MemoryReviewCandidateError.notActionable(candidateId, cur.status);
    }
  });
  run();
}
```

- [ ] **Step 4: PASS → Step 5: Commit** `feat(core): dismiss memory review candidate (#242)`

---

### Task 7: `markMemoryReviewCandidateExpired` + not-found 404

**Files:**

- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.ts`
- Modify: `packages/memento-core/src/domains/memory/services/memory-review-candidate-persistence-service.spec.ts`

- [ ] **Step 1: Add tests**

```typescript
import { markMemoryReviewCandidateExpired } from './memory-review-candidate-persistence-service.js';
import { MEMORY_REVIEW_CANDIDATE_NOT_FOUND } from './memory-review-candidate-persistence-error.js';

it('expire moves pending to expired without touching memory_item importance', () => {
  upsertPendingMemoryReviewCandidates(
    db,
    [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
    NOW,
  );
  const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
  const beforeImp = (
    db.prepare(`SELECT importance FROM memory_item WHERE id = 'mem_a'`).get() as { importance: number }
  ).importance;
  markMemoryReviewCandidateExpired(db, row.id, NOW);
  expect(getMemoryReviewCandidateById(db, row.id)?.status).toBe('expired');
  const afterImp = (
    db.prepare(`SELECT importance FROM memory_item WHERE id = 'mem_a'`).get() as { importance: number }
  ).importance;
  expect(afterImp).toBe(beforeImp);
});

it('unknown id on expire throws not found', () => {
  expect(() =>
    markMemoryReviewCandidateExpired(db, '00000000-0000-0000-0000-000000000000', NOW),
  ).toThrow(MemoryReviewCandidateError);
  try {
    markMemoryReviewCandidateExpired(db, '00000000-0000-0000-0000-000000000000', NOW);
  } catch (e) {
    expect((e as MemoryReviewCandidateError).code).toBe(MEMORY_REVIEW_CANDIDATE_NOT_FOUND);
    expect((e as MemoryReviewCandidateError).statusCode).toBe(404);
  }
});
```

- [ ] **Step 2: Implement `markMemoryReviewCandidateExpired`**

```typescript
export function markMemoryReviewCandidateExpired(
  db: Database.Database,
  candidateId: string,
  now: string,
): void {
  ensureMemoryReviewCandidateSchema(db);
  const run = db.transaction(() => {
    const cur = db
      .prepare<{ status: string }, [string]>(`SELECT status FROM memory_review_candidate WHERE id = ?`)
      .get(candidateId);
    if (!cur) throw MemoryReviewCandidateError.notFound(candidateId);
    if (cur.status !== 'pending') {
      throw MemoryReviewCandidateError.notActionable(candidateId, cur.status);
    }
    const info = db
      .prepare(
        `UPDATE memory_review_candidate SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(now, candidateId);
    if (info.changes === 0) {
      throw MemoryReviewCandidateError.notActionable(candidateId, cur.status);
    }
  });
  run();
}
```

- [ ] **Step 3: Run vitest PASS → Step 4: Commit** `feat(core): expire memory review candidate (#242)`

---

### Task 8: Package exports + verification

**Files:**

- Modify: `packages/memento-core/src/index.ts`

- [ ] **Step 1: Re-export** (mirror #241 block style)

```typescript
export {
  upsertPendingMemoryReviewCandidates,
  getMemoryReviewCandidateById,
  listMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
  markMemoryReviewCandidateDismissed,
  markMemoryReviewCandidateExpired,
} from './domains/memory/services/memory-review-candidate-persistence-service.js';
export type {
  MemoryReviewCandidateStatus,
  MemoryReviewCandidateRow,
  UpsertPendingMemoryReviewCandidateInput,
  UpsertPendingMemoryReviewCandidatesResult,
  ListMemoryReviewCandidatesQuery,
} from './domains/memory/services/memory-review-candidate-persistence.types.js';
export {
  MemoryReviewCandidateError,
  MEMORY_REVIEW_CANDIDATE_NOT_FOUND,
  MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
} from './domains/memory/services/memory-review-candidate-persistence-error.js';
```

- [ ] **Step 2: Run full checks**

```bash
cd /home/jee1lee/git/memento/.worktrees/issue-242-memory-review-persistence
npm run type-check
npm test
```

Expected: both exit 0.

- [ ] **Step 3: Commit** `feat(core): export memory review candidate persistence API (#242)`

---

## Plan self-review (spec coverage)

| Spec section | Tasks |
|--------------|-------|
| Upsert 멱등 | Task 3 |
| list/get | Task 4 |
| pending→reviewed/dismissed/expired | Tasks 5–7 |
| 404 not found / 409 not actionable | Tasks 5–7 tests + error class |
| review updates `last_accessed`/`last_accessed_at` | Task 5 SQL |
| dismiss does not change memory body/importance | Task 6 |
| Core-only (no server) | No server files in map |
| `index.ts` export | Task 8 |

**Placeholder scan:** none intentional.

**Type consistency:** `MemoryReviewCandidateRow`, `now: string` ISO used consistently; `mapRow` coerces DB types.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-05-02-issue-242-memory-review-candidate-persistence.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session using executing-plans checkpoints

**Which approach?**
