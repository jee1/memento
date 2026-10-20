import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { sqliteRepositoryProvider } from '../../../../infrastructure/database/factories/sqlite-repository-provider.js';
import { SearchEngine } from '../../../search/algorithms/search-engine.js';
import { setupTestDatabase } from '../../../../../test/helpers/test-database.js';
import type { ToolContext } from '../../../../tools/types.js';
import { RecallTool } from '../recall-tool.js';

const QUERY = 'deploy checklist shared';
const LIMIT = 2;

function insertProcedural(
  db: Database.Database,
  row: {
    id: string;
    version: number;
    series: string;
    createdAt: string;
    trigger?: Record<string, string>;
  }
): void {
  db.prepare(
    `INSERT INTO memory_item (
      id, type, content, importance, privacy_scope, version, version_series_id, created_at, trigger_conditions
    ) VALUES (?, 'procedural', ?, 0.5, 'private', ?, ?, ?, ?)`
  ).run(
    row.id,
    QUERY,
    row.version,
    row.series,
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
  const result = await tool.handle(
    {
      query: QUERY,
      type: 'procedural',
      enable_hybrid: false,
      auto_set_anchor: false,
      include_metadata: false,
      include_neighbors: false,
      ...params,
    },
    context
  );
  return JSON.parse(result.content[0]?.text ?? '{}') as { items: Array<{ memory_id: string }> };
}

describe('recall still fills limit after version and trigger filters (#1392)', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('latest_only returns limit items when one series has more old versions than limit', async () => {
    db = await setupTestDatabase();
    insertProcedural(db, { id: 'mem_a_v1', version: 1, series: 'series-a', createdAt: '2026-04-01T00:00:00.000Z' });
    insertProcedural(db, { id: 'mem_a_v2', version: 2, series: 'series-a', createdAt: '2026-04-02T00:00:00.000Z' });
    insertProcedural(db, { id: 'mem_a_v3', version: 3, series: 'series-a', createdAt: '2026-04-03T00:00:00.000Z' });
    insertProcedural(db, { id: 'mem_a_v4', version: 4, series: 'series-a', createdAt: '2026-04-04T00:00:00.000Z' });
    insertProcedural(db, { id: 'mem_b_v1', version: 1, series: 'series-b', createdAt: '2026-01-01T00:00:00.000Z' });
    insertProcedural(db, { id: 'mem_c_v1', version: 1, series: 'series-c', createdAt: '2026-01-02T00:00:00.000Z' });

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
      insertProcedural(db, {
        id: `mem_miss_${i}`,
        version: 1,
        series: `series-miss-${i}`,
        createdAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        trigger: { step: 'unrelated' },
      });
    }
    insertProcedural(db, {
      id: 'mem_hit_0',
      version: 1,
      series: 'series-hit-0',
      createdAt: '2026-01-01T00:00:00.000Z',
      trigger: { step: 'deploy' },
    });
    insertProcedural(db, {
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
});
