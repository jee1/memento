import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createSeededBenchmarkDatabase,
  sampleImportance,
  sampleRecallCount,
} from '../lib/benchmark-search-database.js';

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

  it('seeds only the resolved EMBEDDING_PROVIDER (no mandatory mock companion)', async () => {
    const previousProvider = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    const { db, close, embeddingProvider, vectorDims } = await createSeededBenchmarkDatabase(dir);
    try {
      expect(embeddingProvider).toBe('tfidf');
      expect(vectorDims).toBeGreaterThan(0);
      const row = db.prepare('SELECT COUNT(*) AS c FROM memory_item').get() as { c: number };
      expect(row.c).toBe(2);
      const embeddings = db
        .prepare(
          'SELECT embedding_provider AS provider, COUNT(*) AS c FROM memory_embedding GROUP BY embedding_provider'
        )
        .all() as Array<{ provider: string; c: number }>;
      expect(embeddings).toEqual([{ provider: 'tfidf', c: 2 }]);
    } finally {
      close();
      if (previousProvider === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previousProvider;
      }
    }
  }, 120_000);
});

/**
 * #973: 시더가 정답 라벨을 랭킹 피처로 쓰면 안 된다.
 * 예전 구현은 ground-truth.json 을 읽어 importance / last_accessed_at /
 * recall_count 를 갈랐고, importance 두 밴드가 겹치지 않아서 정답이 검색 전에
 * 이미 이겨 있었다.
 */
describe('#973 시더 메타데이터는 정답 라벨과 무관하다', () => {
  type Row = { id: string; importance: number; recall_count: number; last_accessed_at: string | null };

  function writeFixture(dir: string, groundTruthRelevantId: string | null): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        benchmark_version: 'test',
        created_at: new Date().toISOString(),
        corpus_size: 2,
        query_count: 0,
        ground_truth_count: groundTruthRelevantId ? 1 : 0,
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
          created_at: '2025-11-01T00:00:00.000Z',
          content: 'alpha beta gamma search content one',
        }),
        JSON.stringify({
          benchmark_id: 'bench_mem_000002',
          source_memory_id: 'mem_seed_002',
          type: 'episodic',
          tags: ['x'],
          created_at: '2025-12-01T00:00:00.000Z',
          content: 'delta epsilon zeta search content two',
        }),
      ].join('\n') + '\n'
    );
    if (groundTruthRelevantId) {
      writeFileSync(
        join(dir, 'ground-truth.json'),
        JSON.stringify([{ queryId: 'q1', relevantIds: [groundTruthRelevantId] }])
      );
    }
  }

  async function seedAndRead(dir: string): Promise<Row[]> {
    const { db, close } = await createSeededBenchmarkDatabase(dir);
    try {
      return db
        .prepare(
          `SELECT id, importance, recall_count, last_accessed_at FROM memory_item ORDER BY id`
        )
        .all() as Row[];
    } finally {
      close();
    }
  }

  it('정답으로 라벨된 문서가 바뀌어도 메타데이터는 그대로다', async () => {
    const previousProvider = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    const dirA = join(tmpdir(), `bench-973-a-${Date.now()}`);
    const dirB = join(tmpdir(), `bench-973-b-${Date.now()}`);
    try {
      writeFixture(dirA, 'bench_mem_000001');
      writeFixture(dirB, 'bench_mem_000002');
      const rowsA = await seedAndRead(dirA);
      const rowsB = await seedAndRead(dirB);
      expect(rowsA).toHaveLength(2);
      expect(rowsB).toEqual(rowsA);
    } finally {
      if (previousProvider === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previousProvider;
      }
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  }, 120_000);

  it('ground-truth.json 이 아예 없어도 같은 메타데이터가 나온다', async () => {
    const previousProvider = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    const withGt = join(tmpdir(), `bench-973-gt-${Date.now()}`);
    const without = join(tmpdir(), `bench-973-nogt-${Date.now()}`);
    try {
      writeFixture(withGt, 'bench_mem_000001');
      writeFixture(without, null);
      expect(await seedAndRead(without)).toEqual(await seedAndRead(withGt));
    } finally {
      if (previousProvider === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previousProvider;
      }
      rmSync(withGt, { recursive: true, force: true });
      rmSync(without, { recursive: true, force: true });
    }
  }, 120_000);
});

/**
 * #973: 뽑기 분포는 프로덕션 memory_item (is_deleted=0, 9,055행, 2026-09-19 측정)
 * 모양을 따라야 한다. 예전에는 정답 전부에 recall_count 20 이상을 줬는데,
 * 프로덕션에서 그건 0.44% 밖에 없는 특성이다.
 */
describe('#973 뽑기 분포는 프로덕션 모양을 따른다', () => {
  const SAMPLES = 20_000;
  const draws = Array.from({ length: SAMPLES }, (_, i) => (i + 0.5) / SAMPLES);

  it('importance 최빈값은 0.1 이고 평균이 프로덕션 0.494 근처다', () => {
    const values = draws.map((r) => sampleImportance(r));
    const counts = new Map<number, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    expect(top[0]).toBe(0.1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.44);
    expect(mean).toBeLessThan(0.56);
  });

  it('recall_count 가 20 이상인 비율이 1% 미만이다', () => {
    const high = draws.filter((r) => sampleRecallCount(r, 0.5) >= 20).length;
    expect(high / SAMPLES).toBeLessThan(0.01);
    expect(high / SAMPLES).toBeGreaterThan(0.001);
  });

  it('recall_count 0 이 대략 프로덕션 비율(28.7%)이다', () => {
    const zero = draws.filter((r) => sampleRecallCount(r, 0.5) === 0).length;
    expect(zero / SAMPLES).toBeGreaterThan(0.26);
    expect(zero / SAMPLES).toBeLessThan(0.31);
  });
});

/**
 * #973: 합성 문서의 created_at 이 한 값이면 recency 축이 죽는다.
 */
describe('#973 합성 코퍼스의 created_at 은 실제 범위 안에 흩어져 있다', () => {
  it('합성 문서끼리 타임스탬프가 겹치지 않고 실제 문서 범위 안에 있다', () => {
    const corpusPath = join(
      process.cwd(),
      'tests/fixtures/search-quality/benchmark-v3/corpus.jsonl'
    );
    const rows = readFileSync(corpusPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { benchmark_id: string; created_at: string });

    const synthetic = rows.filter((r) => r.benchmark_id.startsWith('bench_syn'));
    const real = rows.filter((r) => !r.benchmark_id.startsWith('bench_syn'));
    expect(synthetic.length).toBeGreaterThan(0);

    expect(new Set(synthetic.map((r) => r.created_at)).size).toBe(synthetic.length);

    const realTimes = real.map((r) => Date.parse(r.created_at)).filter((t) => Number.isFinite(t));
    const lo = Math.min(...realTimes);
    const hi = Math.max(...realTimes);
    for (const s of synthetic) {
      const t = Date.parse(s.created_at);
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(lo);
      expect(t).toBeLessThanOrEqual(hi);
    }
  });
});

/**
 * #973: 예전에는 mulberry32(42) 한 줄기를 코퍼스 순회 순서대로 소비했다.
 * 그래서 문서를 하나만 앞에 끼워 넣어도 그 뒤 모든 문서의 importance ·
 * recall_count · last_accessed_at 이 바뀌었고, 지표가 움직인 이유가 그 문서
 * 때문인지 재추첨 때문인지 구분할 수 없었다.
 */
describe('#973 메타데이터는 코퍼스 안에서의 위치와 무관하다', () => {
  type Row = { id: string; importance: number; recall_count: number; last_accessed_at: string | null };

  const DOC_A = {
    benchmark_id: 'bench_mem_000001',
    source_memory_id: 'mem_seed_001',
    type: 'semantic',
    tags: ['t'],
    created_at: '2025-11-01T00:00:00.000Z',
    content: 'alpha beta gamma search content one',
  };
  const DOC_B = {
    benchmark_id: 'bench_mem_000002',
    source_memory_id: 'mem_seed_002',
    type: 'episodic',
    tags: ['x'],
    created_at: '2025-12-01T00:00:00.000Z',
    content: 'delta epsilon zeta search content two',
  };
  const DOC_INSERTED = {
    benchmark_id: 'bench_mem_000999',
    source_memory_id: 'mem_seed_999',
    type: 'semantic',
    tags: ['z'],
    created_at: '2025-10-01T00:00:00.000Z',
    content: 'iota kappa lambda search content inserted first',
  };

  function writeCorpus(dir: string, docs: ReadonlyArray<Record<string, unknown>>): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        benchmark_version: 'test',
        created_at: new Date().toISOString(),
        corpus_size: docs.length,
        query_count: 0,
        ground_truth_count: 0,
        source: 'full-memory-snapshot',
        labeling_policy: 'binary-human-labeled',
        strict_ci: false,
      })
    );
    writeFileSync(join(dir, 'corpus.jsonl'), docs.map((d) => JSON.stringify(d)).join('\n') + '\n');
  }

  async function seedAndRead(dir: string): Promise<Map<string, Row>> {
    const { db, close } = await createSeededBenchmarkDatabase(dir);
    try {
      const rows = db
        .prepare(`SELECT id, importance, recall_count, last_accessed_at FROM memory_item`)
        .all() as Row[];
      return new Map(rows.map((r) => [r.id, r]));
    } finally {
      close();
    }
  }

  it('앞에 문서를 하나 끼워 넣어도 기존 문서의 메타데이터가 그대로다', async () => {
    const previousProvider = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    const plain = join(tmpdir(), `bench-973-order-a-${Date.now()}`);
    const shifted = join(tmpdir(), `bench-973-order-b-${Date.now()}`);
    try {
      writeCorpus(plain, [DOC_A, DOC_B]);
      writeCorpus(shifted, [DOC_INSERTED, DOC_A, DOC_B]);

      const before = await seedAndRead(plain);
      const after = await seedAndRead(shifted);

      expect(after.size).toBe(3);
      for (const id of ['mem_seed_001', 'mem_seed_002']) {
        expect(after.get(id), `missing ${id}`).toBeDefined();
        expect(after.get(id)).toEqual(before.get(id));
      }
    } finally {
      if (previousProvider === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previousProvider;
      }
      rmSync(plain, { recursive: true, force: true });
      rmSync(shifted, { recursive: true, force: true });
    }
  }, 120_000);
});
