import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSeededBenchmarkDatabase } from './benchmark-search-database.js';

describe('createSeededBenchmarkDatabase seed modes', () => {
  let dir: string;
  const previousProvider = process.env.EMBEDDING_PROVIDER;

  beforeAll(() => {
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    dir = join(tmpdir(), `bench-seed-mode-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'corpus.jsonl'),
      [
        JSON.stringify({
          benchmark_id: 'bench_mem_000002',
          source_memory_id: 'mem_seed_002',
          type: 'episodic',
          content: 'delta epsilon zeta search content two',
        }),
        JSON.stringify({
          benchmark_id: 'bench_mem_000001',
          source_memory_id: 'mem_seed_001',
          type: 'semantic',
          content: 'alpha beta gamma search content one',
        }),
      ].join('\n') + '\n',
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    if (previousProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = previousProvider;
    }
  });

  it('fixture inserts every corpus row and returns sorted benchmark ids', async () => {
    const seeded = await createSeededBenchmarkDatabase(dir, { mode: 'fixture' });
    try {
      expect(seeded.seededBenchmarkIds).toEqual(['bench_mem_000001', 'bench_mem_000002']);
      const row = seeded.db.prepare('SELECT COUNT(*) AS c FROM memory_item').get() as { c: number };
      expect(row.c).toBe(2);
    } finally {
      seeded.close();
    }
  });

  it('subset inserts only the requested ids', async () => {
    const seeded = await createSeededBenchmarkDatabase(dir, {
      mode: 'subset',
      corpusBenchmarkIds: ['bench_mem_000002'],
    });
    try {
      expect(seeded.seededBenchmarkIds).toEqual(['bench_mem_000002']);
      const row = seeded.db.prepare('SELECT id FROM memory_item').all() as Array<{ id: string }>;
      expect(row.map((item) => item.id)).toEqual(['mem_seed_002']);
    } finally {
      seeded.close();
    }
  });

  it('subset throws when an id is missing', async () => {
    await expect(
      createSeededBenchmarkDatabase(dir, {
        mode: 'subset',
        corpusBenchmarkIds: ['missing'],
      }),
    ).rejects.toThrow(/missing/);
  });

  it('scale clones fixture rows as bench_scale_<n> until scaleTo', async () => {
    const seeded = await createSeededBenchmarkDatabase(dir, { mode: 'scale', scaleTo: 4 });
    try {
      expect(seeded.seededBenchmarkIds).toEqual([
        'bench_mem_000001',
        'bench_mem_000002',
        'bench_scale_0',
        'bench_scale_1',
      ]);
      const row = seeded.db.prepare('SELECT COUNT(*) AS c FROM memory_item').get() as { c: number };
      expect(row.c).toBe(4);
    } finally {
      seeded.close();
    }
  });
});
