# Issue #81: Project-Scoped Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `project_id` support to `remember`, `recall`, and `memory_injection` MCP tools, plus HTTP admin endpoints for project stats and cleanup, so AI agents can store and retrieve memories scoped to a specific project.

**Architecture:** A new `project_id TEXT` column is added to `memory_item` via migration 032. The three MCP tools (`remember`, `recall`, `memory_injection`) each get a `project_id` parameter; `recall` and `memory_injection` apply it as an in-memory post-filter (consistent with the existing `owner_id`/`process_id`/`session_id` pattern). Two HTTP admin endpoints handle project stats and bulk cleanup.

**Tech Stack:** TypeScript, better-sqlite3, zod, vitest, Express 5.x (`@memento/core`, `memento-server`)

**Spec:** `docs/superpowers/specs/2026-04-18-issue-81-project-scoped-memory-design.md`

---

## File Map

| File | Change |
|------|--------|
| `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.ts` | **Create** — migration class |
| `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.spec.ts` | **Create** — migration tests |
| `packages/memento-core/src/shared/types/index.ts` | **Modify** — add `project_id` to `MemoryItem` and `MemorySearchFilters` |
| `packages/memento-core/src/domains/memory/tools/remember-tool.ts` | **Modify** — add `project_id` schema param + INSERT |
| `packages/memento-core/src/domains/memory/tools/recall-tool.ts` | **Modify** — add `project_id` to `RecallSearchItem`, `AppliedFilters`, schema, in-memory filter |
| `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts` | **Modify** — add `project_id` schema param + in-memory filter |
| `packages/memento-server/src/server/routes/admin.routes.ts` | **Modify** — add GET stats, GET preview, DELETE cleanup routes |

---

## Task 1: DB Migration 032 — Add `project_id` Column

**Files:**
- Create: `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.ts`
- Create: `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `032-add-project-id.spec.ts`:

```typescript
/**
 * Migration 032 테스트 — memory_item project_id 컬럼
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AddProjectIdMigration } from './032-add-project-id.js';

function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return columns.some(c => c.name === columnName);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`
  ).get(indexName) as { name: string } | undefined;
  return !!row;
}

describe('Migration 032 - project_id column', () => {
  let db: Database.Database;
  let migration: AddProjectIdMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    migration = new AddProjectIdMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('adds project_id column to memory_item', async () => {
    expect(columnExists(db, 'memory_item', 'project_id')).toBe(false);
    await migration.up(db);
    expect(columnExists(db, 'memory_item', 'project_id')).toBe(true);
  });

  it('creates composite partial index on (project_id, type)', async () => {
    await migration.up(db);
    expect(indexExists(db, 'idx_memory_item_project_id_type')).toBe(true);
  });

  it('is idempotent — running up() twice does not throw', async () => {
    await migration.up(db);
    await expect(migration.up(db)).resolves.not.toThrow();
  });

  it('existing rows get NULL project_id after migration', async () => {
    db.exec(`INSERT INTO memory_item (id, type, content) VALUES ('mem_1', 'episodic', 'test')`);
    await migration.up(db);
    const row = db.prepare(`SELECT project_id FROM memory_item WHERE id = 'mem_1'`).get() as { project_id: string | null };
    expect(row.project_id).toBeNull();
  });

  it('validateAfter passes after up()', async () => {
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.spec.ts
```

Expected: FAIL — `Cannot find module './032-add-project-id.js'`

- [ ] **Step 3: Create the migration file**

Create `032-add-project-id.ts`:

```typescript
/**
 * Migration: 032 — memory_item project_id column
 * Version: 32.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class AddProjectIdMigration implements Migration {
  version = '32.0';
  name = 'add-project-id';
  description = 'Add project_id to memory_item for project-scoped memory (Issue #81)';

  private columnExists(db: Database.Database, table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some(r => r.name === column);
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'project_id')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN project_id TEXT`);
    }
    if (!this.indexExists(db, 'idx_memory_item_project_id_type')) {
      db.exec(`
        CREATE INDEX idx_memory_item_project_id_type
          ON memory_item(project_id, type)
          WHERE project_id IS NOT NULL
      `);
    }
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_project_id_type');
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'project_id')) {
      throw new Error('project_id column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_project_id_type')) {
      throw new Error('idx_memory_item_project_id_type was not created');
    }
  }
}

export default AddProjectIdMigration;
```

- [ ] **Step 4: Register the migration**

Find where migrations are registered (look for `030-triple-extraction-fields` import) and add:

```bash
grep -rn "031-soft-delete-fields\|030-triple-extraction" packages/memento-core/src/infrastructure/database/ --include="*.ts" | grep "import" | head -5
```

Add the import and registration in the same file, following the existing pattern:
```typescript
import { AddProjectIdMigration } from './migrations/032-add-project-id.js';
// ... add to the migrations array:
new AddProjectIdMigration(),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.spec.ts
```

Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.ts packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.spec.ts
git commit -m "feat(core): add migration 032 — project_id column on memory_item"
```

---

## Task 2: Update Shared Types

**Files:**
- Modify: `packages/memento-core/src/shared/types/index.ts`

- [ ] **Step 1: Add `project_id` to `MemoryItem`**

In `packages/memento-core/src/shared/types/index.ts`, after `session_id?: string | null` (around line 53), add:

```typescript
  // Project-scoped memory (Issue #81)
  project_id?: string | null;
```

- [ ] **Step 2: Add `project_id` to `MemorySearchFilters`**

In the same file, after `session_id?: string | string[] | undefined` (around line 98), add:

```typescript
  // Project-scoped memory (Issue #81)
  project_id?: string | undefined;
```

- [ ] **Step 3: Type-check**

```bash
npm run type-check -w @memento/core 2>&1 | head -30
```

Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add packages/memento-core/src/shared/types/index.ts
git commit -m "feat(core): add project_id to MemoryItem and MemorySearchFilters types"
```

---

## Task 3: Update `remember` Tool

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/remember-tool.ts`
- Modify: `packages/memento-core/src/domains/memory/tools/__tests__/` or co-located spec

- [ ] **Step 1: Write the failing test**

Find the remember-tool spec file:
```bash
find packages/memento-core/src/domains/memory/tools -name "remember-tool.spec.ts" -o -name "remember*.spec.ts" | head -3
```

In the spec file, add a test for `project_id`:

```typescript
it('stores project_id when provided', async () => {
  const result = await callTool('remember', {
    content: 'PostgreSQL을 사용한다',
    type: 'semantic',
    project_id: 'test-project'
  }, context);

  expect(result.isError).toBe(false);
  // Verify DB
  const row = db.prepare(
    `SELECT project_id FROM memory_item WHERE content = ?`
  ).get('PostgreSQL을 사용한다') as { project_id: string | null } | undefined;
  expect(row?.project_id).toBe('test-project');
});

it('stores NULL project_id when not provided', async () => {
  const result = await callTool('remember', {
    content: '프로젝트 없는 기억',
    type: 'episodic'
  }, context);

  expect(result.isError).toBe(false);
  const row = db.prepare(
    `SELECT project_id FROM memory_item WHERE content = ?`
  ).get('프로젝트 없는 기억') as { project_id: string | null } | undefined;
  expect(row?.project_id).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/ 2>&1 | grep -E "FAIL|PASS|project_id" | head -10
```

Expected: FAIL — `project_id` column does not exist yet (or test runs but assertion fails)

- [ ] **Step 3: Add `project_id` to the schema**

In `remember-tool.ts`, find `RememberSchema = z.object({` and add (near `session_id`):

```typescript
  // Project-scoped memory (Issue #81)
  project_id: z.string().max(200).optional()
    .describe('프로젝트 식별자. 동일 project_id로 저장한 기억끼리 recall/memory_injection 시 필터링 가능'),
```

- [ ] **Step 4: Destructure the new param**

Find `RememberSchema.parse(params)` destructuring and add `project_id`:

```typescript
  project_id,
} = RememberSchema.parse(params);
```

- [ ] **Step 5: Add to INSERT statement**

Find the `INSERT INTO memory_item (` statement (around line 805). Add `project_id` to the column list and `project_id ?? null` to the values array, following the same position as `session_id`:

Column list change:
```
..., owner_id, process_id, session_id, project_id,
num_times, ...
```

Values array change (after `sessionId`):
```typescript
project_id ?? null,
```

Also add `?` to the VALUES placeholders count.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/ 2>&1 | grep -E "FAIL|PASS" | head -10
```

Expected: All tests PASS including the new ones

- [ ] **Step 7: Commit**

```bash
git add packages/memento-core/src/domains/memory/tools/remember-tool.ts
git commit -m "feat(core): add project_id param to remember tool"
```

---

## Task 4: Update `recall` Tool

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`

- [ ] **Step 1: Write the failing test**

Find recall-tool spec and add:

```typescript
it('filters results by project_id — excludes other projects', async () => {
  // Setup: two memories in different projects
  db.exec(`
    INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
    VALUES
      ('mem_proj_a', 'semantic', 'proj-a 결정', 0.8, 'proj-a', datetime('now')),
      ('mem_proj_b', 'semantic', 'proj-b 결정', 0.8, 'proj-b', datetime('now'))
  `);

  const result = await callTool('recall', {
    query: '결정',
    project_id: 'proj-a'
  }, context);

  expect(result.isError).toBe(false);
  const items = result.content[0]?.text ? JSON.parse(result.content[0].text) : [];
  const ids = (items.memories ?? items).map((m: any) => m.memory_id ?? m.id);
  expect(ids).toContain('mem_proj_a');
  expect(ids).not.toContain('mem_proj_b');
});

it('returns all memories when project_id is not specified', async () => {
  db.exec(`
    INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
    VALUES
      ('mem_a', 'semantic', '테스트 A', 0.8, 'proj-a', datetime('now')),
      ('mem_b', 'semantic', '테스트 B', 0.8, NULL, datetime('now'))
  `);

  const result = await callTool('recall', { query: '테스트' }, context);
  expect(result.isError).toBe(false);
  // Both should be returned (no project filter)
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/ -t "project_id" 2>&1 | head -20
```

Expected: FAIL

- [ ] **Step 3: Add `project_id` to `RecallSearchItem` interface**

Around line 356 (after `session_id?: string | null`):

```typescript
  project_id?: string | null;
```

- [ ] **Step 4: Add `project_id` to `AppliedFilters` interface**

Around line 398 (after `session_id?: string | string[]`):

```typescript
  project_id?: string;
```

- [ ] **Step 5: Add `project_id` to the zod schema**

Find the recall schema (look for `owner_id: z.union(...)`) and add after `session_id`:

```typescript
  // Project-scoped memory (Issue #81)
  project_id: z.string().max(200).optional()
    .describe('이 project_id로 저장된 기억만 검색. 미지정 시 전체 검색'),
```

- [ ] **Step 6: Destructure and apply in-memory filter**

In the `handle()` method, destructure `project_id` from parsed params.

Then, after the `session_id` filter block (around line 1039), add:

```typescript
// Project-scoped memory (Issue #81): project_id 필터
if (project_id && searchItems.length > 0) {
  searchItems = searchItems.filter(
    (i: RecallSearchItem) => i.project_id != null && i.project_id === project_id
  );
}
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/ 2>&1 | grep -E "FAIL|PASS" | head -10
```

Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add packages/memento-core/src/domains/memory/tools/recall-tool.ts
git commit -m "feat(core): add project_id filter to recall tool"
```

---

## Task 5: Update `memory_injection` Tool

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts`

- [ ] **Step 1: Write the failing test**

Find or create the memory-injection spec and add:

```typescript
it('injects only project memories when project_id is specified', async () => {
  db.exec(`
    INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
    VALUES
      ('mem_mine', 'semantic', 'proj-x 전용 결정', 0.9, 'proj-x', datetime('now')),
      ('mem_other', 'semantic', '다른 프로젝트 결정', 0.9, 'proj-y', datetime('now')),
      ('mem_none', 'semantic', '프로젝트 없는 기억', 0.9, NULL, datetime('now'))
  `);

  const result = await callTool('memory_injection', {
    query: '결정',
    project_id: 'proj-x'
  }, context);

  expect(result.isError).toBe(false);
  const text = result.content[0]?.text ?? '';
  expect(text).toContain('proj-x 전용 결정');
  expect(text).not.toContain('다른 프로젝트 결정');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/ -t "memory_injection" 2>&1 | head -20
```

Expected: FAIL

- [ ] **Step 3: Add `project_id` to `MemoryInjectionSchema`**

In `memory-injection-prompt.ts`, find `const MemoryInjectionSchema = z.object({` and add:

```typescript
  // Project-scoped memory (Issue #81)
  project_id: z.string().max(200).optional()
    .describe('지정 시 해당 프로젝트 기억만 주입. 미지정 시 전체 기억에서 검색'),
```

- [ ] **Step 4: Add to `super()` properties**

In the `super(...)` call (the MCP schema definition), add after `importance_threshold`:

```typescript
          project_id: {
            type: 'string',
            description: '지정 시 해당 프로젝트 기억만 주입. 미지정 시 전체 기억에서 검색',
            maxLength: 200
          }
```

- [ ] **Step 5: Destructure and apply filter**

In `handle()`, add `project_id` to the destructuring from `MemoryInjectionSchema.parse(params)`.

After `const memories = searchResult.items;`, add:

```typescript
// Project-scoped memory filter (Issue #81)
const filteredMemories = project_id
  ? memories.filter((m: any) => m.project_id != null && m.project_id === project_id)
  : memories;
```

Replace all subsequent references to `memories` in this method with `filteredMemories`.

- [ ] **Step 6: Run tests**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/ 2>&1 | grep -E "FAIL|PASS" | head -10
```

Expected: All PASS

- [ ] **Step 7: Type-check**

```bash
npm run type-check -w @memento/core 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts
git commit -m "feat(core): add project_id filter to memory_injection tool"
```

---

## Task 6: HTTP Admin Routes — Project Stats & Cleanup

**Files:**
- Modify: `packages/memento-server/src/server/routes/admin.routes.ts`

- [ ] **Step 1: Write the failing test**

Find `packages/memento-server/src/server/routes/admin.routes.spec.ts` and add:

```typescript
describe('Project admin routes', () => {
  it('GET /admin/memory/project/:project_id/stats returns counts by type', async () => {
    // Insert test data
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
      VALUES
        ('m1', 'semantic', 'a', 0.5, 'proj-test', datetime('now')),
        ('m2', 'episodic', 'b', 0.5, 'proj-test', datetime('now')),
        ('m3', 'semantic', 'c', 0.5, 'other-proj', datetime('now'))
    `);

    const res = await request(app)
      .get('/admin/memory/project/proj-test/stats')
      .set('X-Admin-Key', TEST_ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.project_id).toBe('proj-test');
    expect(res.body.total).toBe(2);
    expect(res.body.by_type.semantic).toBe(1);
    expect(res.body.by_type.episodic).toBe(1);
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns would_delete without deleting', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
      VALUES ('old_mem', 'episodic', 'old content', 0.5, 'proj-x', '${old}')
    `);

    const res = await request(app)
      .get('/admin/memory/project/proj-x/cleanup/preview?older_than_days=90')
      .set('X-Admin-Key', TEST_ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.would_delete).toBe(1);
    expect(res.body.items[0].id).toBe('old_mem');

    // Verify nothing was deleted
    const count = db.prepare(`SELECT COUNT(*) as c FROM memory_item WHERE id = 'old_mem'`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns 400 when older_than_days missing', async () => {
    const res = await request(app)
      .get('/admin/memory/project/proj-x/cleanup/preview')
      .set('X-Admin-Key', TEST_ADMIN_KEY);
    expect(res.status).toBe(400);
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns 400 when types includes core', async () => {
    const res = await request(app)
      .get('/admin/memory/project/proj-x/cleanup/preview?older_than_days=90&types=core')
      .set('X-Admin-Key', TEST_ADMIN_KEY);
    expect(res.status).toBe(400);
  });

  it('DELETE /admin/memory/project/:project_id/cleanup deletes old memories', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
      VALUES ('del_mem', 'episodic', 'delete me', 0.5, 'proj-del', '${old}')
    `);

    const res = await request(app)
      .delete('/admin/memory/project/proj-del/cleanup?older_than_days=90')
      .set('X-Admin-Key', TEST_ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);

    const count = db.prepare(`SELECT COUNT(*) as c FROM memory_item WHERE id = 'del_mem'`).get() as { c: number };
    expect(count.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run packages/memento-server/src/server/routes/admin.routes.spec.ts 2>&1 | head -20
```

Expected: FAIL — routes not found

- [ ] **Step 3: Add the routes**

In `admin.routes.ts`, after the existing routes (e.g., after the `/embeddings/migrate` route), add:

```typescript
  // Project stats (Issue #81)
  router.get('/memory/project/:project_id/stats', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { project_id } = req.params;

      const total = (db.prepare(
        `SELECT COUNT(*) as c FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`
      ).get(project_id) as { c: number }).c;

      const byTypeRows = db.prepare(
        `SELECT type, COUNT(*) as c FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0 GROUP BY type`
      ).all(project_id) as Array<{ type: string; c: number }>;
      const by_type: Record<string, number> = {};
      for (const row of byTypeRows) {
        by_type[row.type] = row.c;
      }

      const dates = db.prepare(
        `SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`
      ).get(project_id) as { oldest: string | null; newest: string | null };

      return res.json({
        project_id,
        total,
        by_type,
        oldest_created_at: dates.oldest,
        newest_created_at: dates.newest
      });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 통계 조회 실패', message: String(error) });
    }
  });

  // Helper: parse and validate cleanup query params
  function parseCleanupParams(query: Record<string, unknown>): { olderThanDays: number; types: string[] } | { error: string; status: number } {
    const olderThanDays = Number(query['older_than_days']);
    if (!query['older_than_days'] || isNaN(olderThanDays) || olderThanDays <= 0) {
      return { error: 'older_than_days 파라미터가 필요합니다 (양의 정수)', status: 400 };
    }
    const typesRaw = typeof query['types'] === 'string' ? query['types'] : 'episodic,working';
    const types = typesRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (types.includes('core')) {
      return { error: 'core 타입 기억은 삭제할 수 없습니다', status: 400 };
    }
    const allowedTypes = ['working', 'episodic', 'semantic', 'procedural', 'vault'];
    const invalid = types.filter(t => !allowedTypes.includes(t));
    if (invalid.length > 0) {
      return { error: `허용되지 않는 타입: ${invalid.join(', ')}`, status: 400 };
    }
    return { olderThanDays, types };
  }

  // Project cleanup preview (Issue #81)
  router.get('/memory/project/:project_id/cleanup/preview', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { project_id } = req.params;
      const parsed = parseCleanupParams(req.query as Record<string, unknown>);
      if ('error' in parsed) {
        return res.status(parsed.status).json({ error: parsed.error });
      }
      const { olderThanDays, types } = parsed;

      const placeholders = types.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT id, content, type, created_at FROM memory_item
         WHERE project_id = ?
           AND type IN (${placeholders})
           AND created_at < datetime('now', '-${olderThanDays} days')
           AND COALESCE(is_deleted, 0) = 0`
      ).all(project_id, ...types) as Array<{ id: string; content: string; type: string; created_at: string }>;

      return res.json({
        would_delete: rows.length,
        items: rows
      });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 미리보기 실패', message: String(error) });
    }
  });

  // Project cleanup delete (Issue #81)
  router.delete('/memory/project/:project_id/cleanup', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { project_id } = req.params;
      const parsed = parseCleanupParams(req.query as Record<string, unknown>);
      if ('error' in parsed) {
        return res.status(parsed.status).json({ error: parsed.error });
      }
      const { olderThanDays, types } = parsed;

      const placeholders = types.map(() => '?').join(', ');
      const result = db.prepare(
        `DELETE FROM memory_item
         WHERE project_id = ?
           AND type IN (${placeholders})
           AND created_at < datetime('now', '-${olderThanDays} days')
           AND COALESCE(is_deleted, 0) = 0`
      ).run(project_id, ...types);

      return res.json({ deleted: result.changes });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 실패', message: String(error) });
    }
  });
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run packages/memento-server/src/server/routes/admin.routes.spec.ts 2>&1 | grep -E "FAIL|PASS|project" | head -20
```

Expected: All PASS

- [ ] **Step 5: Type-check**

```bash
npm run type-check -w memento-server 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/memento-server/src/server/routes/admin.routes.ts packages/memento-server/src/server/routes/admin.routes.spec.ts
git commit -m "feat(server): add project stats and cleanup admin routes (Issue #81)"
```

---

## Task 7: Full Quality Gate

- [ ] **Step 1: Run full lint**

```bash
npm run lint
```

Expected: No errors. If there are auto-fixable issues run `npm run lint -- --fix`.

- [ ] **Step 2: Run full type-check**

```bash
npm run type-check
```

Expected: No errors

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests PASS (or only pre-existing failures)

- [ ] **Step 4: Run the migration smoke test**

```bash
npm run db:migrate -w @memento/core
```

Expected: Migration 032 applied successfully

- [ ] **Step 5: Final commit (if any lint/format fixes applied)**

```bash
git add -p  # review and stage only relevant changes
git commit -m "chore: lint and type fixes for project-scoped memory feature"
```

---

## Integration Scenario (Manual Verification)

After all tasks complete, verify the end-to-end workflow:

```bash
# Start the server
npm run dev:http

# 1. Store a project decision
curl -X POST http://localhost:7860/mcp \
  -H "Content-Type: application/json" \
  -d '{"tool":"remember","params":{"content":"이 프로젝트는 PostgreSQL 사용","type":"semantic","project_id":"my-project","importance":0.9}}'

# 2. Verify isolation — store something in a different project
curl -X POST http://localhost:7860/mcp \
  -H "Content-Type: application/json" \
  -d '{"tool":"remember","params":{"content":"다른 프로젝트 결정","type":"semantic","project_id":"other-project","importance":0.9}}'

# 3. Recall — should only return my-project memory
curl -X POST http://localhost:7860/mcp \
  -H "Content-Type: application/json" \
  -d '{"tool":"recall","params":{"query":"프로젝트 기술 스택","project_id":"my-project"}}'

# 4. Check stats
curl http://localhost:7860/admin/memory/project/my-project/stats \
  -H "X-Admin-Key: $ADMIN_KEY"

# 5. Preview cleanup (dry run)
curl "http://localhost:7860/admin/memory/project/my-project/cleanup/preview?older_than_days=90" \
  -H "X-Admin-Key: $ADMIN_KEY"
```
