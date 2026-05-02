# Issue #243 memory review admin API + batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `GET /admin/memory/review-candidates` (metadata-only rows), `POST .../:id/review`, `POST .../:id/dismiss` with 200/400/404/409 mapping to `MemoryReviewCandidateError`; add `BatchScheduler` job `memory_review_candidates` (select → upsert) on a configurable interval; extend `POST /admin/batch/run` to accept `memory_review_candidates`; add Vitest coverage in `memento-server` and `memento-core`. No dashboard UI.

**Architecture:** Thin Express handlers in `admin.routes.ts` call `@memento/core` persistence/selection functions already exported from `index.ts`. `BatchScheduler` gains a private `runMemoryReviewCandidatesJob()` mirroring `runMemoryCleanup` (DB open check → `selectMemoryReviewCandidates` → map to upsert inputs with env-driven `due_at` → `upsertPendingMemoryReviewCandidates`). `runJob` union extended; schedule via `scheduleJob('memory_review_candidates', …, priority 8)`.

**Tech Stack:** TypeScript ESM, Express 5, `better-sqlite3`, Vitest, `uuid` (`validate`) in memento-server, `@memento/core` public APIs: `selectMemoryReviewCandidates`, `upsertPendingMemoryReviewCandidates`, `listMemoryReviewCandidates`, `markMemoryReviewCandidateReviewed`, `markMemoryReviewCandidateDismissed`, `MemoryReviewCandidateError`.

**Spec:** `docs/superpowers/specs/2026-05-02-issue-243-memory-review-admin-api-design.md`

---

## File map

| File | Action |
|------|--------|
| `packages/memento-core/src/index.ts` | Modify — export `MetaMemoryStatsSchemaMigration` + `MemoryReviewCandidateSchemaMigration` for server Vitest fixtures |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler-types.ts` | Modify — add `memoryReviewCandidatesInterval: number` |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler-validate-config.ts` | Modify — validate interval ≥ 60000 |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` | Modify — defaults, `start()`, `runJob`, new private job method |
| `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts` | Modify — pass new config in `beforeEach`; add `runJob('memory_review_candidates')` + `activeJobs` tests |
| `packages/memento-server/src/server/routes/admin.routes.ts` | Modify — routes + imports |
| `packages/memento-server/src/server/routes/admin.routes.spec.ts` | Modify — new `describe` for review-candidates API |

---

## Constants (copy into implementation)

- Env `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS`: default `86_400_000` (24h), min `60_000`.
- Env `MEMORY_REVIEW_CANDIDATE_DUE_DAYS`: default `14`, min `1`, max `366` (read inside batch job mapping via `resolveValidatedNumber` from `@memento/core` shared `environment` — same as other batch env reads in `batch-scheduler.ts`).

---

### Task 0: Export migrations for server tests

**Files:**

- Modify: `packages/memento-core/src/index.ts`

- [ ] **Step 1: Re-export migration classes** (paths match dist layout after `tsc`)

```typescript
export { MetaMemoryStatsSchemaMigration } from './infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
export { MemoryReviewCandidateSchemaMigration } from './infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
```

- [ ] **Step 2: Build core + commit**

```bash
npm run build -w @memento/core
git add packages/memento-core/src/index.ts
git commit -m "feat(core): export migrations for admin review-candidate tests (#243)"
```

---

### Task 1: Extend `BatchJobConfig` + validation

**Files:**

- Modify: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler-types.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler-validate-config.ts`

- [ ] **Step 1: Add field to interface**

In `BatchJobConfig`, after `telemetryCleanupInterval` (or nearby batch intervals), add:

```typescript
  /** Issue #243: refresh memory_review_candidate pending rows from selection */
  memoryReviewCandidatesInterval: number;
```

- [ ] **Step 2: Validate in `validateBatchJobConfig`**

Append before the closing `}`:

```typescript
  if (config.memoryReviewCandidatesInterval < 60000) {
    throw new Error('memoryReviewCandidatesInterval must be at least 1 minute');
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/memento-core/src/infrastructure/scheduler/batch-scheduler-types.ts \
  packages/memento-core/src/infrastructure/scheduler/batch-scheduler-validate-config.ts
git commit -m "feat(core): add memoryReviewCandidatesInterval to batch config (#243)"
```

---

### Task 2: `BatchScheduler` — defaults, schedule, `runJob`, job body

**Files:**

- Modify: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`

- [ ] **Step 1: Constructor default + env**

Inside the `this.config = { ... }` object in the constructor (near other `resolveValidatedNumber` calls), add:

```typescript
      memoryReviewCandidatesInterval: resolveValidatedNumber(
        'MEMORY_REVIEW_CANDIDATES_INTERVAL_MS',
        24 * 60 * 60 * 1000,
        n => n >= 60_000,
        '최솟값 60000'
      ),
```

- [ ] **Step 2: Import domain functions at top of file**

Add to existing imports (same style as other scheduler imports):

```typescript
import { selectMemoryReviewCandidates } from '../../domains/memory/services/memory-review-candidate-selection-service.js';
import { upsertPendingMemoryReviewCandidates } from '../../domains/memory/services/memory-review-candidate-persistence-service.js';
```

(`resolveValidatedNumber` is already imported in this file.)

- [ ] **Step 3: Schedule in `start()` after `meta_memory_introspection` block**

After the `scheduleJob('meta_memory_introspection', …)` block and **before** `this.startJobProcessor()`, add:

```typescript
    this.scheduleJob(
      'memory_review_candidates',
      this.config.memoryReviewCandidatesInterval,
      async () => {
        await this.runMemoryReviewCandidatesJob();
      },
      8
    );
```

Use priority **8** so it stays below priority-7 quality batch jobs.

- [ ] **Step 4: Implement `private async runMemoryReviewCandidatesJob(): Promise<BatchJobResult>`**

Place near other `run*` private methods:

```typescript
  private async runMemoryReviewCandidatesJob(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'memory_review_candidates',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      if (!DatabaseUtils.isOpen(this.db)) {
        throw new Error('Database connection is not open. The database may have been closed.');
      }

      const items = selectMemoryReviewCandidates(this.db);
      const dueDays = resolveValidatedNumber(
        'MEMORY_REVIEW_CANDIDATE_DUE_DAYS',
        14,
        n => n >= 1 && n <= 366,
        '1-366'
      );
      const nowIso = new Date().toISOString();
      const dueAt = new Date(Date.now() + dueDays * 86_400_000).toISOString();

      const inputs = items.map(i => ({
        memory_id: i.memory_id,
        priority: i.priority,
        reason: i.reason,
        due_at: dueAt,
        metadata_json: JSON.stringify({ score_breakdown: i.score_breakdown })
      }));

      const upsert = upsertPendingMemoryReviewCandidates(this.db, inputs, nowIso);
      result.success = true;
      result.processed = inputs.length;
      result.details = { inserted: upsert.inserted, updated: upsert.updated };

      this.log('Memory review candidates batch completed', {
        selected: items.length,
        inserted: upsert.inserted,
        updated: upsert.updated
      });
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Memory review candidates batch failed', {
        error: error instanceof Error ? error.message : String(error)
      }, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }
```

Do **not** log `memory_item.content`; the above logs counts only.

- [ ] **Step 5: Extend `runJob` union + switch**

Change signature to include `'memory_review_candidates'` in the union type, add:

```typescript
      case 'memory_review_candidates':
        result = await this.runMemoryReviewCandidatesJob();
        break;
```

- [ ] **Step 6: Duplicate `start()` path if file has restart helper**

If `batch-scheduler.ts` contains a second `start`/`reschedule` block (search for duplicate `scheduleJob('cleanup'`) around line 1030), add the same `memory_review_candidates` `scheduleJob` there too so restarts behave identically.

- [ ] **Step 7: Run core tests**

```bash
npm run test:prepare && npx vitest --run packages/memento-core/src/infrastructure/scheduler/batch-scheduler.spec.ts
```

Expected: PASS (fix any missing config in test constructor).

- [ ] **Step 8: Commit**

```bash
git add packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts
git commit -m "feat(core): add memory_review_candidates batch job (#243)"
```

---

### Task 3: `batch-scheduler.spec.ts` — config + smoke tests

**Files:**

- Modify: `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts`

- [ ] **Step 1: Extend `beforeEach` scheduler config**

In `new BatchScheduler({ ... })` (first `beforeEach` around line 27), add:

```typescript
      memoryReviewCandidatesInterval: 60000,
```

- [ ] **Step 2: Add tests under `describe('runJob - 수동 작업 실행', …)`**

```typescript
    it('memory_review_candidates 작업을 수동으로 실행해야 함', async () => {
      await scheduler.start(db);

      const result = await scheduler.runJob('memory_review_candidates');

      expect(result).toBeDefined();
      expect(result.jobType).toBe('memory_review_candidates');
      expect(result).toHaveProperty('success');
    });
```

```typescript
    it('시작 후 activeJobs에 memory_review_candidates가 포함되어야 함', async () => {
      await scheduler.start(db);
      const status = scheduler.getStatus();
      expect(status.activeJobs).toContain('memory_review_candidates');
    });
```

- [ ] **Step 3: Run file + commit**

```bash
npx vitest --run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts
git add packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts
git commit -m "test(core): cover memory_review_candidates batch (#243)"
```

---

### Task 4: Admin HTTP routes

**Files:**

- Modify: `packages/memento-server/src/server/routes/admin.routes.ts`

- [ ] **Step 1: Imports**

Add to `@memento/core` import list (same block as `getBatchScheduler`):

```typescript
  listMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
  markMemoryReviewCandidateDismissed,
  MemoryReviewCandidateError,
  type MemoryReviewCandidateStatus
} from '@memento/core';
```

Add at file top (after express imports):

```typescript
import { validate as uuidValidate } from 'uuid';
```

- [ ] **Step 2: Helper `parseReviewCandidateStatusQuery`**

Near `parseCleanupParams`, add:

```typescript
const MEMORY_REVIEW_STATUSES: MemoryReviewCandidateStatus[] = [
  'pending',
  'reviewed',
  'dismissed',
  'expired'
];

function parseReviewCandidateStatusQuery(
  raw: unknown
): { status?: MemoryReviewCandidateStatus } | { error: string; status: number } {
  if (raw === undefined || raw === '') {
    return {};
  }
  if (typeof raw !== 'string' || !MEMORY_REVIEW_STATUSES.includes(raw as MemoryReviewCandidateStatus)) {
    return { error: 'Invalid status query', status: 400 };
  }
  return { status: raw as MemoryReviewCandidateStatus };
}
```

- [ ] **Step 3: `GET /admin/memory/review-candidates`**

Inside `createAdminRouter`:

```typescript
  router.get('/memory/review-candidates', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const parsed = parseReviewCandidateStatusQuery(req.query['status']);
      if ('error' in parsed) {
        return res.status(parsed.status).json({ error: parsed.error });
      }
      const rows = listMemoryReviewCandidates(db, parsed.status ? { status: parsed.status } : {});
      return res.json({
        message: 'Memory review candidates',
        candidates: rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('List review candidates failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to list review candidates',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
```

- [ ] **Step 4: `POST .../review` and `POST .../dismiss`**

```typescript
  router.post('/memory/review-candidates/:id/review', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { id } = req.params;
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const nowIso = new Date().toISOString();
      markMemoryReviewCandidateReviewed(db, id, nowIso);
      const row = listMemoryReviewCandidates(db, {}).find(r => r.id === id);
      return res.json({ ok: true, candidate: row ?? null, timestamp: nowIso });
    } catch (error) {
      if (error instanceof MemoryReviewCandidateError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error('Review candidate review failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to mark reviewed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/memory/review-candidates/:id/dismiss', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { id } = req.params;
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const nowIso = new Date().toISOString();
      markMemoryReviewCandidateDismissed(db, id, nowIso);
      const row = listMemoryReviewCandidates(db, {}).find(r => r.id === id);
      return res.json({ ok: true, candidate: row ?? null, timestamp: nowIso });
    } catch (error) {
      if (error instanceof MemoryReviewCandidateError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error('Review candidate dismiss failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to dismiss candidate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
```

**Note:** For large DBs, replace post-mutation `listMemoryReviewCandidates(db, {}).find` with `getMemoryReviewCandidateById` (exported from `@memento/core`) in a follow-up.

- [ ] **Step 5: Extend `POST /admin/batch/run` allowlist**

Replace the `includes` array:

```typescript
      if (!jobType || !['cleanup', 'monitoring', 'memory_review_candidates'].includes(jobType)) {
        return res.status(400).json({
          error: 'Invalid job type. Must be "cleanup", "monitoring", or "memory_review_candidates"'
        });
      }
```

- [ ] **Step 6: Build + server tests subset**

```bash
npm run build -w @memento/core && npm run build -w memento-server
npx vitest --run packages/memento-server/src/server/routes/admin.routes.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/memento-server/src/server/routes/admin.routes.ts
git commit -m "feat(server): admin review-candidates API and batch/run (#243)"
```

---

### Task 5: `admin.routes.spec.ts` — integration tests

**Files:**

- Modify: `packages/memento-server/src/server/routes/admin.routes.spec.ts`

- [ ] **Step 1: Imports for migrations + core**

```typescript
import { randomUUID } from 'node:crypto';
import {
  MemoryReviewCandidateSchemaMigration,
  MetaMemoryStatsSchemaMigration,
  upsertPendingMemoryReviewCandidates
} from '@memento/core';
```

(Task 0 must be done first.)

- [ ] **Step 2: New `describe('Admin memory review candidates', …)`**

Pattern: mirror `Project memory admin routes` — `Database(':memory:')`, `app.use('/admin', createAdminRouter(database, null));`, `listen`.

**Setup helper** (inline in spec file, copied from `memory-review-candidate-selection-service.spec.ts`):

```typescript
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
```

`beforeEach`: `createBaseSchema(db)` → `await new MetaMemoryStatsSchemaMigration().up(db)` → `await new MemoryReviewCandidateSchemaMigration().up(db)` → insert one `memory_item` + one `meta_memory_stats` row (copy the two `INSERT` blocks from `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts` lines 52–79, using `mem_stale`).

Seed pending candidate and capture id:

```typescript
const NOW = '2026-06-01T12:00:00.000Z';
upsertPendingMemoryReviewCandidates(
  db,
  [
    {
      memory_id: 'mem_stale',
      priority: 10,
      reason: 'test seed',
      due_at: '2026-07-01T00:00:00.000Z',
      metadata_json: null
    }
  ],
  NOW
);
const row = db.prepare(`SELECT id FROM memory_review_candidate WHERE memory_id = ? AND status = 'pending'`).get('mem_stale') as { id: string };
const pendingId = row.id;
```

Tests:

```typescript
  it('GET /admin/memory/review-candidates returns 200 and no memory_item.content field', async () => {
    const res = await getAdmin(port, '/admin/memory/review-candidates');
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(Array.isArray(json.candidates)).toBe(true);
    const first = json.candidates[0];
    if (first) {
      expect(first).not.toHaveProperty('content');
      expect(first).toHaveProperty('memory_id');
    }
  });

  it('GET /admin/memory/review-candidates?status=bad returns 400', async () => {
    const res = await getAdmin(port, '/admin/memory/review-candidates?status=bad');
    expect(res.statusCode).toBe(400);
  });

  it('POST review twice returns 409 on second call', async () => {
    const res1 = await postAdminJson(port, `/admin/memory/review-candidates/${pendingId}/review`, {});
    expect(res1.statusCode).toBe(200);
    const res2 = await postAdminJson(port, `/admin/memory/review-candidates/${pendingId}/review`, {});
    expect(res2.statusCode).toBe(409);
    const j2 = JSON.parse(res2.body);
    expect(j2.code).toBe('memory_review_candidate_not_actionable');
  });

  it('POST dismiss for unknown UUID returns 404', async () => {
    const id = randomUUID();
    const res = await postAdminJson(port, `/admin/memory/review-candidates/${id}/dismiss`, {});
    expect(res.statusCode).toBe(404);
  });

  it('POST review with invalid id returns 400', async () => {
    const res = await postAdminJson(port, '/admin/memory/review-candidates/not-a-uuid/review', {});
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 3: Run vitest + commit**

```bash
npx vitest --run packages/memento-server/src/server/routes/admin.routes.spec.ts
git add packages/memento-server/src/server/routes/admin.routes.spec.ts
git commit -m "test(server): admin memory review candidates routes (#243)"
```

---

### Task 6: Full gate

- [ ] **Step 1: Root test + lint**

```bash
npm test
npm run lint
```

Expected: all PASS, lint clean.

- [ ] **Step 2: Final commit** (only if fixes needed)

```bash
git add -A
git commit -m "chore: fix lint for #243"
```

---

## Plan self-review

| Spec section | Task coverage |
|--------------|---------------|
| GET list metadata-only | Task 4 route + Task 5 assert no `content` |
| status query 400 | Task 4 parser + Task 5 |
| POST review/dismiss + 404/409 | Task 4 + Task 5 |
| Batch schedule + `getStatus` | Task 2–3 |
| `runJob` + `/admin/batch/run` | Task 2 + Task 4 step 5 |
| Logging without memory content | Task 2 log lines (counts only); routes use generic errors |
| `due_at` / `metadata_json` | Task 2 mapping |
| Server test DB setup | Task 0 exports + Task 5 |

**Placeholder scan:** none.

**Type consistency:** `runJob('memory_review_candidates')` matches extended union; admin `jobType` string matches.

---

## Execution handoff

**Plan complete.** 저장 위치: `docs/superpowers/plans/2026-05-02-issue-243-memory-review-admin-api.md` (워크트리 `feature/issue-243-review-candidates-api`에 커밋할 것).

**실행 방식 선택:**

1. **Subagent-Driven (권장)** — 태스크마다 새 서브에이전트, 태스크 사이 리뷰.  
2. **Inline Execution** — 같은 세션에서 `executing-plans` 체크포인트로 순차 실행.

구현을 시작할 때 어떤 방식으로 할지 알려 주세요.
