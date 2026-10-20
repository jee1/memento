import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { sqliteRepositoryProvider } from '../../../../infrastructure/database/factories/sqlite-repository-provider.js';
import { SearchEngine } from '../../../search/algorithms/search-engine.js';
import { setupTestDatabase } from '../../../../../test/helpers/test-database.js';
import type { ToolContext } from '../../../../tools/types.js';
import { RecallTool } from '../recall-tool.js';

const QUERY = 'deploy checklist shared';
const LIMIT = 2;

function insertMemory(
  db: Database.Database,
  row: {
    id: string;
    createdAt: string;
    type?: 'procedural' | 'semantic';
    version?: number;
    series?: string;
    trigger?: Record<string, string>;
  }
): void {
  db.prepare(
    `INSERT INTO memory_item (
      id, type, content, importance, privacy_scope, version, version_series_id, created_at, trigger_conditions
    ) VALUES (?, ?, ?, 0.5, 'private', ?, ?, ?, ?)`
  ).run(
    row.id,
    row.type ?? 'procedural',
    QUERY,
    row.version ?? null,
    row.series ?? null,
    row.createdAt,
    row.trigger ? JSON.stringify(row.trigger) : null
  );
}

async function recall(
  db: Database.Database,
  params: Record<string, unknown>
): Promise<{ items: Array<{ memory_id: string }> }> {
  const tool = new RecallTool();
  const context = {
    db,
    services: {
      repositories: sqliteRepositoryProvider,
      searchEngine: new SearchEngine(sqliteRepositoryProvider),
      hybridSearchEngine: { isEmbeddingAvailable: () => false },
    },
  } as unknown as ToolContext;
  const request: Record<string, unknown> = {
    query: QUERY,
    type: 'procedural',
    enable_hybrid: false,
    auto_set_anchor: false,
    include_metadata: false,
    include_neighbors: false,
    ...params,
  };
  if ('memory_types' in params) delete request.type;
  const result = await tool.handle(request, context);
  return JSON.parse(result.content[0]?.text ?? '{}') as { items: Array<{ memory_id: string }> };
}

describe('recall still fills limit after version and trigger filters (#1392)', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('latest_only returns limit items when one series has more old versions than limit', async () => {
    db = await setupTestDatabase();
    insertMemory(db, { id: 'mem_a_v1', version: 1, series: 'series-a', createdAt: '2026-04-01T00:00:00.000Z' });
    insertMemory(db, { id: 'mem_a_v2', version: 2, series: 'series-a', createdAt: '2026-04-02T00:00:00.000Z' });
    insertMemory(db, { id: 'mem_a_v3', version: 3, series: 'series-a', createdAt: '2026-04-03T00:00:00.000Z' });
    insertMemory(db, { id: 'mem_a_v4', version: 4, series: 'series-a', createdAt: '2026-04-04T00:00:00.000Z' });
    insertMemory(db, { id: 'mem_b_v1', version: 1, series: 'series-b', createdAt: '2026-01-01T00:00:00.000Z' });
    insertMemory(db, { id: 'mem_c_v1', version: 1, series: 'series-c', createdAt: '2026-01-02T00:00:00.000Z' });

    const everything = await recall(db, { limit: 10, version_filter: 'all_versions' });
    expect(everything.items).toHaveLength(6);

    const latest = await recall(db, { limit: LIMIT, version_filter: 'latest_only' });
    const ids = latest.items.map((item) => item.memory_id);

    expect(ids).toHaveLength(LIMIT);
    expect(ids).toContain('mem_a_v4');
    expect(ids).not.toContain('mem_a_v1');
    expect(ids).not.toContain('mem_a_v2');
    expect(ids).not.toContain('mem_a_v3');
  });

  it('match_trigger_conditions returns limit matches when non-matches fill the first page', async () => {
    db = await setupTestDatabase();
    for (let i = 0; i < 8; i += 1) {
      insertMemory(db, {
        id: `mem_miss_${i}`,
        version: 1,
        series: `series-miss-${i}`,
        createdAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        trigger: { step: 'unrelated' },
      });
    }
    insertMemory(db, {
      id: 'mem_hit_0',
      version: 1,
      series: 'series-hit-0',
      createdAt: '2026-01-01T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });
    insertMemory(db, {
      id: 'mem_hit_1',
      version: 1,
      series: 'series-hit-1',
      createdAt: '2026-01-02T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });

    const open = await recall(db, { limit: 10 });
    expect(open.items).toHaveLength(10);

    const matched = await recall(db, { limit: LIMIT, match_trigger_conditions: true });
    const ids = matched.items.map((item) => item.memory_id).sort();

    expect(ids).toEqual(['mem_hit_0', 'mem_hit_1']);
  });

  it('keeps a higher-scored procedural match ahead of semantic matches when latest_only and trigger overfetch cut the page', async () => {
    db = await setupTestDatabase();
    for (let i = 0; i < 4; i += 1) {
      insertMemory(db, {
        id: `mem_miss_${i}`,
        type: 'semantic',
        createdAt: `2026-08-0${i + 1}T00:00:00.000Z`,
        trigger: { step: 'unrelated' },
      });
    }
    insertMemory(db, {
      id: 'mem_proc',
      version: 2,
      series: 'series-proc',
      createdAt: '2026-07-01T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });
    insertMemory(db, {
      id: 'mem_sem_new',
      type: 'semantic',
      createdAt: '2026-01-03T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });
    insertMemory(db, {
      id: 'mem_sem_mid',
      type: 'semantic',
      createdAt: '2026-01-02T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });
    insertMemory(db, {
      id: 'mem_sem_old',
      type: 'semantic',
      createdAt: '2026-01-01T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });

    const matched = await recall(db, {
      limit: LIMIT,
      memory_types: ['semantic', 'procedural'],
      version_filter: 'latest_only',
      match_trigger_conditions: true,
    });
    const ids = matched.items.map((item) => item.memory_id);

    expect(ids).toEqual(['mem_proc', 'mem_sem_new']);
  });
});
