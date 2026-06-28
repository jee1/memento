import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSeededBenchmarkDatabase } from './benchmark-search-database.js';

describe('createSeededBenchmarkDatabase', () => {
  let dir: string;

  beforeAll(() => {
    dir = join(tmpdir(), `bench-seed-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        benchmark_version: 'test',
        created_at: new Date().toISOString(),
        corpus_size: 2,
        query_count: 0,
        ground_truth_count: 0,
        source: 'full-memory-snapshot',
        labeling_policy: 'binary-human-labeled',
        strict_ci: false,
      })
    );
    writeFileSync(
      join(dir, 'corpus.jsonl'),
      [
        JSON.stringify({
          benchmark_id: 'bench_mem_000001',
          source_memory_id: 'mem_seed_001',
          type: 'semantic',
          tags: ['t'],
          content: 'alpha beta gamma search content one',
        }),
        JSON.stringify({
          benchmark_id: 'bench_mem_000002',
          source_memory_id: 'mem_seed_002',
          type: 'episodic',
          tags: ['x'],
          content: 'delta epsilon zeta search content two',
        }),
      ].join('\n') + '\n'
    );
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('corpus 행만큼 memory_item·임베딩이 생긴다', async () => {
    const prev = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    const { db, close } = await createSeededBenchmarkDatabase(dir);
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM memory_item').get() as { c: number };
      expect(row.c).toBe(2);
      const emb = db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number };
      expect(emb.c).toBe(4); // corpus 2행 × (tfidf + mock) provider
    } finally {
      close();
      if (prev === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = prev;
      }
    }
  }, 120_000);
});
