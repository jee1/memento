import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchRanking } from '../../packages/memento-core/src/domains/search/algorithms/search-ranking.js';
import { BENCHMARK_REFERENCE_TIME, withBenchmarkClock } from './benchmark-clock.js';
import { createSeededBenchmarkDatabase } from './benchmark-search-database.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('benchmark reference clock', () => {
  it('keeps seeded timestamps and production recency/usage identical across host dates', async () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'tfidf');
    const dir = mkdtempSync(join(tmpdir(), 'benchmark-clock-'));
    writeFileSync(join(dir, 'corpus.jsonl'), Array.from({ length: 8 }, (_, i) => JSON.stringify({
      benchmark_id: `bench_mem_${i}`,
      source_memory_id: `mem_clock_${i}`,
      type: 'semantic',
      content: `reference clock synthetic search document ${i}`,
      ...(i % 2 === 0 ? { created_at: '2026-10-01T00:00:00.000Z' } : {}),
    })).join('\n'));
    const snapshots = [];
    try {
      for (const hostTime of ['2026-10-22T12:00:00.000Z', '2027-11-07T12:00:00.000Z']) {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(hostTime);
        snapshots.push(await withBenchmarkClock(async () => {
          const seeded = await createSeededBenchmarkDatabase(dir);
          try {
            const rows = seeded.db.prepare(
              'SELECT id, created_at, last_accessed_at FROM memory_item ORDER BY id',
            ).all() as Array<{ id: string; created_at: string; last_accessed_at: string | null }>;
            expect(rows.some((row) => row.last_accessed_at !== null)).toBe(true);
            const ranking = new SearchRanking();
            return rows.map((row) => ({
              ...row,
              recency: ranking.calculateRecency(new Date(row.created_at)),
              usage: ranking.calculateUsageSimple(row.last_accessed_at ? new Date(row.last_accessed_at) : undefined),
            }));
          } finally {
            seeded.close();
          }
        }));
        expect(new Date().toISOString()).toBe(hostTime);
        vi.useRealTimers();
      }
      expect(snapshots[1]).toEqual(snapshots[0]);
      expect(snapshots[0]?.some((row) => row.created_at === BENCHMARK_REFERENCE_TIME)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores the host clock after a rejection and preserves explicit dates', async () => {
    const systemDate = Date;
    await expect(withBenchmarkClock(async () => {
      expect(Date.now()).toBe(Date.parse(BENCHMARK_REFERENCE_TIME));
      expect(new Date().toISOString()).toBe(BENCHMARK_REFERENCE_TIME);
      expect(Date()).toBe(new Date(BENCHMARK_REFERENCE_TIME).toString());
      expect(new Date(0).getTime()).toBe(0);
      expect(new Date(2020, 0, 2).getFullYear()).toBe(2020);
      expect(new Date() instanceof Date).toBe(true);
      expect(Date.UTC(1970, 0, 1)).toBe(0);
      throw new Error('measurement failed');
    })).rejects.toThrow('measurement failed');
    expect(Date).toBe(systemDate);
  });

  it('keeps the monotonic duration clock running while ranking time is frozen', async () => {
    await withBenchmarkClock(async () => {
      const started = performance.now();
      const rankingTime = Date.now();
      await delay(15);
      expect(performance.now() - started).toBeGreaterThanOrEqual(10);
      expect(Date.now()).toBe(rankingTime);
    });
  });
});
