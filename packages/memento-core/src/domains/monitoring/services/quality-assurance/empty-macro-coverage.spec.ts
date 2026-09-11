import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { CategoryQualityAggregator } from './category-quality-aggregator.js';

/**
 * Minimal fixture: 4 macros authored, but tag_filter GT all empty → scored=0 for that macro.
 * Regression for #934: collect() must still emit tag_filter with authored>0 (not drop the row).
 */
function writeEmptyMacroFixture(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      benchmark_version: 'v3-test',
      created_at: '2026-09-12T00:00:00.000Z',
      corpus_size: 1,
      query_count: 4,
      ground_truth_count: 4,
      source: 'full-memory-snapshot',
      labeling_policy: 'binary-human-labeled',
      strict_ci: true,
      ground_truth_reviewed: false,
    })
  );
  writeFileSync(
    join(dir, 'queries.json'),
    JSON.stringify([
      { query_id: 'q_e1', query: 'episodic query', language: 'ko', category: 'incident' },
      { query_id: 'q_p1', query: 'procedural query', language: 'ko', category: 'procedure' },
      { query_id: 'q_c1', query: 'conceptual query', language: 'ko', category: 'search' },
      { query_id: 'q_t1', query: 'tag filter query', language: 'ko', category: 'testing' },
    ])
  );
  writeFileSync(
    join(dir, 'ground-truth.json'),
    JSON.stringify([
      { queryId: 'episodic query', relevantIds: ['bench_t_1'] },
      { queryId: 'procedural query', relevantIds: ['bench_t_1'] },
      { queryId: 'conceptual query', relevantIds: ['bench_t_1'] },
      { queryId: 'tag filter query', relevantIds: [] },
    ])
  );
  writeFileSync(
    join(dir, 'corpus.jsonl'),
    `${JSON.stringify({
      benchmark_id: 'bench_t_1',
      source_memory_id: 'syn_t_1',
      type: 'semantic',
      tags: ['test'],
      created_at: '2026-09-12T00:00:00.000Z',
      content: 'fixture content for empty-macro coverage',
    })}\n`
  );
  const mapPath = join(dir, 'category-mapping.json');
  writeFileSync(
    mapPath,
    JSON.stringify({
      macro_categories: {
        episodic_recent: ['incident'],
        procedural: ['procedure'],
        conceptual: ['search'],
        tag_filter: ['testing'],
      },
      query_overrides: {},
      query_id_to_category: {
        q_e1: 'incident',
        q_p1: 'procedure',
        q_c1: 'search',
        q_t1: 'testing',
      },
    })
  );
  return mapPath;
}

describe('CategoryQualityAggregator empty-macro coverage (#934)', () => {
  let db: Database.Database;
  let dir: string;

  beforeEach(async () => {
    db = await setupTestDatabase();
    dir = join(tmpdir(), `bm-empty-macro-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('macro 전체 GT가 비어도 collect()가 authored를 유지한 scored=0 행을 낸다', async () => {
    const mapPath = writeEmptyMacroFixture(dir);
    const reports = await new CategoryQualityAggregator(db).collect(dir, mapPath);

    expect(reports.map((r) => r.macro_category)).toEqual([
      'episodic_recent',
      'procedural',
      'conceptual',
      'tag_filter',
    ]);
    const tag = reports.find((r) => r.macro_category === 'tag_filter');
    expect(tag).toEqual(
      expect.objectContaining({
        query_count: 0,
        authored_query_count: 1,
        threshold_passed: false,
      })
    );
    const scored = reports.reduce((s, r) => s + r.query_count, 0);
    const authored = reports.reduce((s, r) => s + r.authored_query_count, 0);
    expect(scored).toBe(3);
    expect(authored).toBe(4);
    expect(scored / authored).toBe(0.75);
  });
});
