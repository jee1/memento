# Issue #241 memory review candidate selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `selectMemoryReviewCandidates` in `@memento/core` that reads `memory_item` + `meta_memory_stats`, applies env-driven thresholds, excludes pinned / soft-deleted / pending rows, and returns each candidate with `priority`, `reason`, and `score_breakdown` (no DB writes).

**Architecture:** Hybrid (spec §4-C): one SQL query JOINs `memory_item` LEFT JOIN `meta_memory_stats`, filters with `NOT EXISTS` for pending candidates, orders with a wide LIMIT `K`, then TypeScript recomputes `stale_days`, filters by stale threshold, assigns `priority`/`reason`/`score_breakdown`, sorts by `priority` DESC, slices to `maxCandidates`. Pure date/score helpers live in a separate module for fast Vitest coverage.

**Tech Stack:** TypeScript (ESM), `better-sqlite3`, Vitest, existing migrations `011-meta-memory-stats-schema` and `033-memory-review-candidate-schema` for `:memory:` integration tests.

**Spec:** `docs/superpowers/specs/2026-05-02-issue-241-memory-review-candidate-selection-design.md`

---

## File map

| File | Action |
|------|--------|
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection.types.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.spec.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.spec.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.ts` | Create |
| `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts` | Create |
| `packages/memento-core/src/index.ts` | Modify — re-export public API + types |

---

### Task 1: Types + scoring helpers + unit tests

**Files:**
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection.types.ts`
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.ts`
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.spec.ts`

- [ ] **Step 1: Write failing tests** in `memory-review-candidate-selection-scoring.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  MS_PER_DAY,
  parseSqliteInstant,
  resolveStaleAnchor,
  computeStaleDays,
  computeStaleRatio,
  computePriority,
  buildScoreBreakdown,
  buildReason,
  isMemoryRowActive,
  passesEligibility,
} from './memory-review-candidate-selection-scoring.js';
import type { MemoryReviewCandidateSourceRow } from './memory-review-candidate-selection.types.js';

describe('memory-review-candidate-selection-scoring', () => {
  it('computeStaleDays uses floor of UTC day difference', () => {
    const anchor = new Date('2026-05-01T12:00:00.000Z');
    const now = new Date('2026-05-15T11:59:59.999Z');
    expect(computeStaleDays(now, anchor)).toBe(13);
    const now2 = new Date('2026-05-15T12:00:00.000Z');
    expect(computeStaleDays(now2, anchor)).toBe(14);
  });

  it('resolveStaleAnchor uses last_recalled_at when present', () => {
    const row: MemoryReviewCandidateSourceRow = {
      memory_id: 'm1',
      importance: 0.8,
      pinned: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      last_recalled_at: '2026-04-01T00:00:00.000Z',
    };
    const r = resolveStaleAnchor(row);
    expect(r?.kind).toBe('last_recalled_at');
    expect(r?.anchor.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('resolveStaleAnchor falls back to created_at when last_recalled_at null', () => {
    const row: MemoryReviewCandidateSourceRow = {
      memory_id: 'm1',
      importance: 0.8,
      pinned: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: '2026-01-10T00:00:00.000Z',
      last_recalled_at: null,
    };
    const r = resolveStaleAnchor(row);
    expect(r?.kind).toBe('created_at_fallback');
    expect(r?.anchor.toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });

  it('computePriority matches spec §6.1', () => {
    const staleRatio = 2; // e.g. stale_days=28, threshold=14 → min(2,3)=2
    expect(computePriority(0.7, staleRatio)).toBe(0.7 * 1000 + 2 * 100);
  });

  it('passesEligibility respects importance and stale_days thresholds', () => {
    const now = new Date('2026-05-15T12:00:00.000Z');
    const anchor13 = new Date('2026-05-02T12:00:00.000Z'); // 13d before now
    const row: MemoryReviewCandidateSourceRow = {
      memory_id: 'm1',
      importance: 0.7,
      pinned: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      last_recalled_at: anchor13.toISOString(),
    };
    expect(passesEligibility(row, now, { importanceThreshold: 0.7, staleDays: 14 })).toBe(false);
    const anchor14 = new Date('2026-05-01T12:00:00.000Z');
    const row2 = { ...row, last_recalled_at: anchor14.toISOString() };
    expect(passesEligibility(row2, now, { importanceThreshold: 0.7, staleDays: 14 })).toBe(true);
  });

  it('isMemoryRowActive excludes pinned and soft-deleted', () => {
    const base: MemoryReviewCandidateSourceRow = {
      memory_id: 'm1',
      importance: 0.8,
      pinned: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      last_recalled_at: null,
    };
    expect(isMemoryRowActive(base)).toBe(true);
    expect(isMemoryRowActive({ ...base, pinned: 1 })).toBe(false);
    expect(isMemoryRowActive({ ...base, is_deleted: 1 })).toBe(false);
    expect(isMemoryRowActive({ ...base, deleted_at: '2026-01-02' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.spec.ts`

Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Add `memory-review-candidate-selection.types.ts`**

```typescript
/** Anchor kind for stale_days (spec §6.2) */
export type MemoryReviewStaleAnchorKind = 'last_recalled_at' | 'created_at_fallback';

/** One row from the SQL JOIN (spec §5.1) */
export interface MemoryReviewCandidateSourceRow {
  memory_id: string;
  importance: number;
  pinned: number | boolean;
  is_deleted: number | boolean;
  deleted_at: string | null;
  created_at: string;
  last_recalled_at: string | null;
}

export interface MemoryReviewCandidateScoreBreakdown {
  importance: number;
  stale_days: number;
  anchor_kind: MemoryReviewStaleAnchorKind;
  threshold_importance: number;
  threshold_stale_days: number;
}

export interface MemoryReviewCandidateSelectionItem {
  memory_id: string;
  priority: number;
  reason: string;
  score_breakdown: MemoryReviewCandidateScoreBreakdown;
}

export interface MemoryReviewCandidateSelectionThresholds {
  importanceThreshold: number;
  staleDays: number;
  maxCandidates: number;
}

/** Caller-supplied options (tests inject `now`) */
export interface MemoryReviewCandidateSelectionOptions extends MemoryReviewCandidateSelectionThresholds {
  now: Date;
}
```

- [ ] **Step 4: Implement `memory-review-candidate-selection-scoring.ts`**

```typescript
import type {
  MemoryReviewCandidateSourceRow,
  MemoryReviewCandidateScoreBreakdown,
  MemoryReviewStaleAnchorKind,
} from './memory-review-candidate-selection.types.js';

export const MS_PER_DAY = 86_400_000;

export function parseSqliteInstant(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveStaleAnchor(
  row: MemoryReviewCandidateSourceRow
): { anchor: Date; kind: MemoryReviewStaleAnchorKind } | null {
  const fromRecall = parseSqliteInstant(row.last_recalled_at);
  if (fromRecall) return { anchor: fromRecall, kind: 'last_recalled_at' };
  const created = parseSqliteInstant(row.created_at);
  if (!created) return null;
  return { anchor: created, kind: 'created_at_fallback' };
}

export function computeStaleDays(now: Date, anchor: Date): number {
  return Math.floor((now.getTime() - anchor.getTime()) / MS_PER_DAY);
}

export function computeStaleRatio(staleDays: number, thresholdStaleDays: number): number {
  const denom = Math.max(thresholdStaleDays, 1);
  return Math.min(staleDays / denom, 3);
}

export function computePriority(importance: number, staleRatio: number): number {
  return importance * 1000 + staleRatio * 100;
}

export function isMemoryRowActive(row: MemoryReviewCandidateSourceRow): boolean {
  const pinned = row.pinned === true || row.pinned === 1;
  const deleted = row.is_deleted === true || row.is_deleted === 1;
  const soft = row.deleted_at != null && row.deleted_at !== '';
  return !pinned && !deleted && !soft;
}

export function passesEligibility(
  row: MemoryReviewCandidateSourceRow,
  now: Date,
  thresholds: { importanceThreshold: number; staleDays: number }
): boolean {
  if (!isMemoryRowActive(row)) return false;
  if (row.importance < thresholds.importanceThreshold) return false;
  const anchorInfo = resolveStaleAnchor(row);
  if (!anchorInfo) return false;
  const staleDays = computeStaleDays(now, anchorInfo.anchor);
  return staleDays >= thresholds.staleDays;
}

export function buildScoreBreakdown(
  row: MemoryReviewCandidateSourceRow,
  staleDays: number,
  anchorKind: MemoryReviewStaleAnchorKind,
  thresholds: { importanceThreshold: number; staleDays: number }
): MemoryReviewCandidateScoreBreakdown {
  return {
    importance: row.importance,
    stale_days: staleDays,
    anchor_kind: anchorKind,
    threshold_importance: thresholds.importanceThreshold,
    threshold_stale_days: thresholds.staleDays,
  };
}

export function buildReason(
  row: MemoryReviewCandidateSourceRow,
  staleDays: number,
  anchorKind: MemoryReviewStaleAnchorKind,
  thresholds: { importanceThreshold: number; staleDays: number }
): string {
  return `eligible: importance=${row.importance.toFixed(3)}>=${thresholds.importanceThreshold}, stale=${staleDays}d>=${thresholds.staleDays}d, anchor=${anchorKind}`;
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-review-candidate-selection.types.ts \
  packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.ts \
  packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.spec.ts
git commit -m "feat(core): add memory review candidate selection scoring helpers (#241)"
```

---

### Task 2: Env parsing + tests

**Files:**
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.ts`
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.spec.ts`

- [ ] **Step 1: Write failing tests** in `memory-review-candidate-selection-env.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseMemoryReviewSelectionEnv } from './memory-review-candidate-selection-env.js';

describe('parseMemoryReviewSelectionEnv', () => {
  const keys = [
    'MEMORY_REVIEW_IMPORTANCE_THRESHOLD',
    'MEMORY_REVIEW_STALE_DAYS',
    'MEMORY_REVIEW_MAX_CANDIDATES',
  ] as const;

  beforeEach(() => {
    for (const k of keys) delete process.env[k];
  });

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it('returns defaults when env unset', () => {
    const t = parseMemoryReviewSelectionEnv();
    expect(t.importanceThreshold).toBe(0.7);
    expect(t.staleDays).toBe(14);
    expect(t.maxCandidates).toBe(50);
  });

  it('parses valid overrides', () => {
    process.env.MEMORY_REVIEW_IMPORTANCE_THRESHOLD = '0.85';
    process.env.MEMORY_REVIEW_STALE_DAYS = '30';
    process.env.MEMORY_REVIEW_MAX_CANDIDATES = '12';
    const t = parseMemoryReviewSelectionEnv();
    expect(t.importanceThreshold).toBe(0.85);
    expect(t.staleDays).toBe(30);
    expect(t.maxCandidates).toBe(12);
  });

  it('clamps invalid importance to default', () => {
    process.env.MEMORY_REVIEW_IMPORTANCE_THRESHOLD = '2';
    const t = parseMemoryReviewSelectionEnv();
    expect(t.importanceThreshold).toBe(0.7);
  });

  it('falls back stale days and max when non-positive', () => {
    process.env.MEMORY_REVIEW_STALE_DAYS = '0';
    process.env.MEMORY_REVIEW_MAX_CANDIDATES = '-3';
    const t = parseMemoryReviewSelectionEnv();
    expect(t.staleDays).toBe(14);
    expect(t.maxCandidates).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `memory-review-candidate-selection-env.ts`**

```typescript
import type { MemoryReviewCandidateSelectionThresholds } from './memory-review-candidate-selection.types.js';

const DEFAULT_IMPORTANCE = 0.7;
const DEFAULT_STALE_DAYS = 14;
const DEFAULT_MAX = 50;

function clampImportance(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_IMPORTANCE;
  return n;
}

function clampPositiveInt(n: number, fallback: number): number {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return n;
}

export function parseMemoryReviewSelectionEnv(): MemoryReviewCandidateSelectionThresholds {
  const rawImp = process.env.MEMORY_REVIEW_IMPORTANCE_THRESHOLD;
  const importanceThreshold =
    rawImp === undefined || rawImp === '' ? DEFAULT_IMPORTANCE : clampImportance(parseFloat(rawImp));

  const rawStale = process.env.MEMORY_REVIEW_STALE_DAYS;
  const staleParsed = rawStale === undefined || rawStale === '' ? NaN : parseInt(rawStale, 10);
  const staleDays = clampPositiveInt(staleParsed, DEFAULT_STALE_DAYS);

  const rawMax = process.env.MEMORY_REVIEW_MAX_CANDIDATES;
  const maxParsed = rawMax === undefined || rawMax === '' ? NaN : parseInt(rawMax, 10);
  const maxCandidates = clampPositiveInt(maxParsed, DEFAULT_MAX);

  return { importanceThreshold, staleDays, maxCandidates };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.ts \
  packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.spec.ts
git commit -m "feat(core): parse MEMORY_REVIEW_* env for candidate selection (#241)"
```

---

### Task 3: Service + integration tests + exports

**Files:**
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.ts`
- Create: `packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts`
- Modify: `packages/memento-core/src/index.ts`

- [ ] **Step 1: Write failing integration test** (pattern from `meta-memory-introspection-service.spec.ts`: `:memory:` DB, minimal `memory_item`, run migrations `011` and `033`).

Create `memory-review-candidate-selection-service.spec.ts` with:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
import { selectMemoryReviewCandidates } from './memory-review-candidate-selection-service.js';

function createBaseMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned INTEGER DEFAULT 0,
      tags TEXT,
      source TEXT,
      project_id TEXT,
      is_deleted INTEGER DEFAULT 0 NOT NULL,
      deleted_at TEXT
    );
  `);
}

describe('selectMemoryReviewCandidates', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseMemoryItemTable(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns a stale high-importance memory with reason and score_breakdown', () => {
    const now = new Date('2026-05-20T12:00:00.000Z');
    const oldRecall = '2026-04-01T12:00:00.000Z'; // >14d before now
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at)
      VALUES ('mem_a', 'semantic', 'x', 0.75, 'private', '2026-01-01T00:00:00.000Z', 0, 0, NULL);
    `);
    db.exec(`
      INSERT INTO meta_memory_stats (memory_id, recall_count, success_count, failure_count, avg_confidence, last_recalled_at, created_at, updated_at)
      VALUES ('mem_a', 1, 1, 0, 0.9, '${oldRecall}', datetime('now'), datetime('now'));
    `);

    const items = selectMemoryReviewCandidates(db, {
      now,
      importanceThreshold: 0.7,
      staleDays: 14,
      maxCandidates: 50,
    });

    expect(items.some((i) => i.memory_id === 'mem_a')).toBe(true);
    const hit = items.find((i) => i.memory_id === 'mem_a')!;
    expect(hit.priority).toBeGreaterThan(0);
    expect(hit.reason).toContain('eligible:');
    expect(hit.score_breakdown.anchor_kind).toBe('last_recalled_at');
    expect(hit.score_breakdown.stale_days).toBeGreaterThanOrEqual(14);
  });

  it('excludes memory with pending review candidate', () => {
    const now = new Date('2026-05-20T12:00:00.000Z');
    const oldRecall = '2026-04-01T12:00:00.000Z';
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at)
      VALUES ('mem_b', 'semantic', 'x', 0.75, 'private', '2026-01-01T00:00:00.000Z', 0, 0, NULL);
    `);
    db.exec(`
      INSERT INTO meta_memory_stats (memory_id, recall_count, success_count, failure_count, avg_confidence, last_recalled_at, created_at, updated_at)
      VALUES ('mem_b', 1, 1, 0, 0.9, '${oldRecall}', datetime('now'), datetime('now'));
    `);
    db.exec(`
      INSERT INTO memory_review_candidate (id, memory_id, status, priority, reason, due_at, created_at, updated_at)
      VALUES ('cand1', 'mem_b', 'pending', 1.0, 'test', datetime('now'), datetime('now'), datetime('now'));
    `);

    const items = selectMemoryReviewCandidates(db, {
      now,
      importanceThreshold: 0.7,
      staleDays: 14,
      maxCandidates: 50,
    });
    expect(items.some((i) => i.memory_id === 'mem_b')).toBe(false);
  });
});
```

Adjust `INSERT INTO meta_memory_stats` column list to match migration 011 exactly (copy from `meta-memory-introspection-service.spec.ts`).

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts`

- [ ] **Step 3: Implement `memory-review-candidate-selection-service.ts`**

```typescript
import Database from 'better-sqlite3';
import { ensureMetaMemoryStatsSchema } from '../../../shared/utils/ensure-meta-memory-stats-schema.js';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';
import type {
  MemoryReviewCandidateSelectionItem,
  MemoryReviewCandidateSelectionOptions,
  MemoryReviewCandidateSourceRow,
} from './memory-review-candidate-selection.types.js';
import {
  resolveStaleAnchor,
  computeStaleDays,
  computeStaleRatio,
  computePriority,
  buildScoreBreakdown,
  buildReason,
  passesEligibility,
} from './memory-review-candidate-selection-scoring.js';
import { parseMemoryReviewSelectionEnv } from './memory-review-candidate-selection-env.js';

function selectionWindowLimit(maxCandidates: number): number {
  return Math.max(maxCandidates * 10, 200);
}

export function selectMemoryReviewCandidates(
  db: Database.Database,
  options?: Partial<MemoryReviewCandidateSelectionOptions>
): MemoryReviewCandidateSelectionItem[] {
  const env = parseMemoryReviewSelectionEnv();
  const merged: MemoryReviewCandidateSelectionOptions = {
    importanceThreshold: options?.importanceThreshold ?? env.importanceThreshold,
    staleDays: options?.staleDays ?? env.staleDays,
    maxCandidates: options?.maxCandidates ?? env.maxCandidates,
    now: options?.now ?? new Date(),
  };

  ensureMetaMemoryStatsSchema(db);
  ensureMemoryReviewCandidateSchema(db);

  const limitK = selectionWindowLimit(merged.maxCandidates);
  const stmt = db.prepare(`
    SELECT
      m.id AS memory_id,
      m.importance AS importance,
      m.pinned AS pinned,
      m.is_deleted AS is_deleted,
      m.deleted_at AS deleted_at,
      m.created_at AS created_at,
      s.last_recalled_at AS last_recalled_at
    FROM memory_item m
    LEFT JOIN meta_memory_stats s ON s.memory_id = m.id
    WHERE (m.pinned = 0 OR m.pinned IS NULL)
      AND m.is_deleted = 0
      AND (m.deleted_at IS NULL OR m.deleted_at = '')
      AND m.importance >= ?
      AND NOT EXISTS (
        SELECT 1 FROM memory_review_candidate c
        WHERE c.memory_id = m.id AND c.status = 'pending'
      )
    ORDER BY m.importance DESC, COALESCE(s.last_recalled_at, m.created_at) ASC
    LIMIT ?
  `);

  const rows = stmt.all(merged.importanceThreshold, limitK) as MemoryReviewCandidateSourceRow[];

  const items: MemoryReviewCandidateSelectionItem[] = [];
  for (const row of rows) {
    if (!passesEligibility(row, merged.now, merged)) continue;
    const anchorInfo = resolveStaleAnchor(row);
    if (!anchorInfo) continue;
    const staleDays = computeStaleDays(merged.now, anchorInfo.anchor);
    const staleRatio = computeStaleRatio(staleDays, merged.staleDays);
    const priority = computePriority(row.importance, staleRatio);
    const score_breakdown = buildScoreBreakdown(row, staleDays, anchorInfo.kind, merged);
    const reason = buildReason(row, staleDays, anchorInfo.kind, merged);
    items.push({ memory_id: row.memory_id, priority, reason, score_breakdown });
  }

  items.sort((a, b) => b.priority - a.priority);
  return items.slice(0, merged.maxCandidates);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts`

- [ ] **Step 5: Export from `packages/memento-core/src/index.ts`**

Add:

```typescript
export {
  selectMemoryReviewCandidates,
} from './domains/memory/services/memory-review-candidate-selection-service.js';
export { parseMemoryReviewSelectionEnv } from './domains/memory/services/memory-review-candidate-selection-env.js';
export type {
  MemoryReviewCandidateSelectionItem,
  MemoryReviewCandidateSelectionOptions,
  MemoryReviewCandidateSelectionThresholds,
  MemoryReviewCandidateSourceRow,
  MemoryReviewCandidateScoreBreakdown,
  MemoryReviewStaleAnchorKind,
} from './domains/memory/services/memory-review-candidate-selection.types.js';
```

- [ ] **Step 6: Type-check + full core tests**

Run: `npm run type-check`

Run: `npx vitest run packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-scoring.spec.ts packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-env.spec.ts packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.ts \
  packages/memento-core/src/domains/memory/services/memory-review-candidate-selection-service.spec.ts \
  packages/memento-core/src/index.ts
git commit -m "feat(core): select memory review candidates from DB (#241)"
```

---

## Self-review (plan vs spec)

| Spec section | Covered by |
|--------------|------------|
| §3 stale definition + NULL fallback | Task 1 `resolveStaleAnchor`, tests |
| §5 types | Task 1 types file + Task 3 output shape |
| §6 priority / reason / breakdown | Task 1 helpers + Task 3 assembly |
| §7 SQL + window K | Task 3 `selectionWindowLimit` + SQL |
| §8 env vars | Task 2 + merge in Task 3 |
| §9 module location | File paths under `domains/memory/services/` |
| §10 tests | Tasks 1–3 specs |
| §2.2 non-goals (no INSERT) | Service only SELECTs |

**Placeholder scan:** None intentional; integration test SQL must match real `meta_memory_stats` columns — verify against `011-meta-memory-stats-schema.ts` before committing.

---

## Execution

Plan saved on branch `issue/241-review-candidates` under `docs/superpowers/plans/`.

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-issue-241-memory-review-candidate-selection.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
