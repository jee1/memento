import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createSeededBenchmarkDatabase } from './benchmark-search-database.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const relationPocDir = join(repoRoot, 'tests/fixtures/search-quality/relation-poc');
const benchmarkV3Dir = join(repoRoot, 'tests/fixtures/search-quality/benchmark-v3');

function countRelationsJsonlLines(benchmarkDir: string): number {
  const content = readFileSync(join(benchmarkDir, 'relations.jsonl'), 'utf8');
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

describe('#959 benchmark relations seeding', () => {
  let seeded: Awaited<ReturnType<typeof createSeededBenchmarkDatabase>>;
  let previousProvider: string | undefined;

  beforeAll(async () => {
    previousProvider = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    seeded = await createSeededBenchmarkDatabase(relationPocDir);
  }, 120_000);

  afterAll(() => {
    seeded?.close();
    if (previousProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = previousProvider;
    }
  });

  it('#959: relations.jsonl 의 간선이 전부 memory_relation 에 적재된다', () => {
    const expected = countRelationsJsonlLines(relationPocDir);
    const row = seeded.db.prepare('SELECT COUNT(*) AS c FROM memory_relation').get() as { c: number };
    expect(row.c).toBe(expected);
    expect(seeded.relationCount).toBe(expected);
  });

  it('#959: 간선의 source_id·target_id 가 memory_item.id 로 해석된다', () => {
    const orphans = seeded.db
      .prepare(
        `SELECT mr.source_id, mr.target_id
         FROM memory_relation mr
         LEFT JOIN memory_item src ON src.id = mr.source_id
         LEFT JOIN memory_item tgt ON tgt.id = mr.target_id
         WHERE src.id IS NULL OR tgt.id IS NULL`
      )
      .all() as Array<{ source_id: string; target_id: string }>;
    expect(orphans).toEqual([]);

    const endpoints = seeded.db
      .prepare(
        `SELECT source_id AS id FROM memory_relation
         UNION
         SELECT target_id AS id FROM memory_relation`
      )
      .all() as Array<{ id: string }>;
    for (const { id } of endpoints) {
      expect(id.startsWith('relpoc_')).toBe(true);
    }
  });

  it('#959: 문제 기록에서 최종 결정까지 2-hop 으로 도달한다', () => {
    const startId = 'relpoc_prob_000001';
    const decisionId = 'relpoc_dec_000001';

    const oneHop = seeded.db
      .prepare('SELECT target_id FROM memory_relation WHERE source_id = ?')
      .all(startId) as Array<{ target_id: string }>;
    expect(oneHop.map((row) => row.target_id)).not.toContain(decisionId);

    const twoHop = seeded.db
      .prepare(
        `SELECT mr2.target_id AS target_id
         FROM memory_relation mr1
         JOIN memory_relation mr2 ON mr1.target_id = mr2.source_id
         WHERE mr1.source_id = ?`
      )
      .all(startId) as Array<{ target_id: string }>;
    expect(twoHop.map((row) => row.target_id)).toContain(decisionId);
  });

  it('#959: relations.jsonl 이 없는 벤치마크는 관계를 적재하지 않는다', () => {
    expect(existsSync(join(benchmarkV3Dir, 'relations.jsonl'))).toBe(false);
  });
});
