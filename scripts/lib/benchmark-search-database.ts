/**
 * offline 검색 품질 스크립트용: benchmark-v3 corpus.jsonl을 그대로 올린 SQLite DB를 만든다.
 * DB_PATH의 운영 DB가 아니라 코퍼스만 담은 DB에서 측정해야 CI/로컬 결과가 동일하다.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  closeDatabase,
  DatabaseUtils,
  initializeDatabase,
  MemoryEmbeddingService,
} from '@memento/core';
import {
  loadBenchmarkCorpus,
  type BenchmarkCorpusEntry,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import {
  resolveBenchmarkEmbeddingProvider,
} from '@memento/core/shared/types/benchmark.types.js';
import type { EmbeddingProvider } from '@memento/core/shared/types/embedding.types.js';

const VALID_TYPES = new Set(['working', 'episodic', 'semantic', 'procedural']);

/**
 * 문서 id 로 시드를 나눈다 (#973).
 *
 * 예전에는 mulberry32(42) 한 줄기를 코퍼스 순회 순서대로 소비했다. 그러면
 * 문서를 하나만 넣거나 빼도 그 뒤 모든 문서의 메타데이터가 바뀌어서, 지표가
 * 움직인 이유가 그 문서 때문인지 재추첨 때문인지 구분할 수 없다.
 */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 프로덕션 importance 분포 (memory_item, is_deleted=0, 9,055행, 2026-09-19 측정).
 * 값이 연속이 아니라 몇 개 지점에 뭉쳐 있어서 균등분포로 흉내 낼 수 없다.
 * 표에 없는 나머지 6%는 0.1~0.95 균등 꼬리로 채운다.
 */
const IMPORTANCE_DISTRIBUTION: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.321],
  [0.4, 0.012],
  [0.5, 0.117],
  [0.55, 0.091],
  [0.6, 0.027],
  [0.7, 0.111],
  [0.75, 0.015],
  [0.8, 0.094],
  [0.85, 0.059],
  [0.9, 0.075],
  [0.95, 0.018],
];

export function sampleImportance(r: number): number {
  let cumulative = 0;
  for (const [value, weight] of IMPORTANCE_DISTRIBUTION) {
    cumulative += weight;
    if (r < cumulative) {
      return value;
    }
  }
  return 0.1 + (r - cumulative) / Math.max(1 - cumulative, 1e-9) * 0.85;
}

/**
 * 프로덕션 recall_count 분포: 0 이 28.7%, 1~4 가 68.6%, 5~19 가 2.2%,
 * 20 이상이 0.44% (40/9,055). 예전 구현은 정답 전부에 20 이상을 줬다.
 */
export function sampleRecallCount(r: number, r2: number): number {
  if (r < 0.287) return 0;
  if (r < 0.973) return 1 + Math.floor(r2 * 4);
  if (r < 0.995) return 5 + Math.floor(r2 * 15);
  return 20 + Math.floor(r2 * 31);
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeMemoryType(
  type: string
): Parameters<MemoryEmbeddingService['createAndStoreEmbedding']>[3] {
  if (VALID_TYPES.has(type)) {
    return type as Parameters<MemoryEmbeddingService['createAndStoreEmbedding']>[3];
  }
  return 'semantic';
}

export interface SeededBenchmarkDb {
  db: Database.Database;
  dbPath: string;
  close: () => void;
  embeddingProvider: EmbeddingProvider;
  vectorDims: number;
  relationCount: number;
}

/**
 * @param benchmarkDir manifest/corpus.jsonl이 있는 디렉터리 (예: tests/fixtures/search-quality/benchmark-v3)
 * @param options.dbPath 지정 시 해당 경로에 DB 파일을 만들고, close 시 삭제하지 않음(디버그용)
 */
export async function createSeededBenchmarkDatabase(
  benchmarkDir: string,
  options?: { dbPath?: string }
): Promise<SeededBenchmarkDb> {
  const corpus = loadBenchmarkCorpus(benchmarkDir);
  if (corpus.length === 0) {
    throw new Error(`Benchmark corpus is empty: ${benchmarkDir}`);
  }

  const provider = resolveBenchmarkEmbeddingProvider();

  const useTempDir = !options?.dbPath;
  const tmpRoot = useTempDir ? mkdtempSync(join(tmpdir(), 'memento-bench-')) : null;
  const dbPath = options?.dbPath ?? join(tmpRoot!, 'benchmark.db');

  if (options?.dbPath && existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  const db = await initializeDatabase(dbPath);
  const embeddingService = new MemoryEmbeddingService();

  let vectorDims = 0;
  let relationCount = 0;

  try {
    for (let i = 0; i < corpus.length; i++) {
      const entry = corpus[i]!;
      const dims = await seedOneCorpusRow(db, embeddingService, entry, provider);
      if (vectorDims === 0) {
        vectorDims = dims;
      }
      if ((i + 1) % 500 === 0) {
        process.stderr.write(`[benchmark-seed] ${i + 1}/${corpus.length} provider=${provider}\n`);
      }
    }
    relationCount = seedBenchmarkRelations(db, corpus, benchmarkDir);
  } catch (e) {
    closeDatabase(db);
    if (useTempDir && tmpRoot) {
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    } else if (options?.dbPath) {
      try {
        unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
    throw e;
  }

  if (vectorDims <= 0) {
    closeDatabase(db);
    throw new Error(`Benchmark seed produced no embeddings for provider="${provider}"`);
  }

  const close = (): void => {
    try {
      closeDatabase(db);
    } finally {
      if (useTempDir && tmpRoot) {
        try {
          rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  };

  return { db, dbPath, close, embeddingProvider: provider, vectorDims, relationCount };
}

/**
 * relations.jsonl 이 있으면 memory_relation 에 적재한다 (#959).
 * 파일이 없는 벤치마크(benchmark-v3)는 동작이 바뀌지 않는다.
 * source/target 은 benchmark_id 이므로 source_memory_id 로 바꿔 넣는다.
 */
function seedBenchmarkRelations(
  db: Database.Database,
  corpus: BenchmarkCorpusEntry[],
  benchmarkDir: string
): number {
  const relationsPath = join(benchmarkDir, 'relations.jsonl');
  if (!existsSync(relationsPath)) {
    return 0;
  }

  const benchmarkIdToMemoryId = new Map<string, string>();
  for (const entry of corpus) {
    benchmarkIdToMemoryId.set(entry.benchmark_id, entry.source_memory_id);
  }

  const lines = readFileSync(relationsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  let count = 0;
  for (const line of lines) {
    const row = JSON.parse(line) as {
      source: string;
      target: string;
      relation_type: string;
      confidence: number;
    };
    const sourceId = benchmarkIdToMemoryId.get(row.source);
    if (!sourceId) {
      throw new Error(`Benchmark relation references unknown benchmark_id: ${row.source}`);
    }
    const targetId = benchmarkIdToMemoryId.get(row.target);
    if (!targetId) {
      throw new Error(`Benchmark relation references unknown benchmark_id: ${row.target}`);
    }
    DatabaseUtils.run(
      db,
      `INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`,
      [sourceId, targetId, row.relation_type, row.confidence]
    );
    count++;
  }

  process.stderr.write(`[benchmark-seed] relations=${count}\n`);
  return count;
}

export async function seedOneCorpusRow(
  db: Database.Database,
  embeddingService: MemoryEmbeddingService,
  entry: BenchmarkCorpusEntry,
  provider: EmbeddingProvider
): Promise<number> {
  const id = entry.source_memory_id;
  const type = normalizeMemoryType(entry.type);
  const tagsJson = JSON.stringify(entry.tags ?? []);
  const createdAt = entry.created_at ?? new Date().toISOString();

  // #973: 메타데이터는 문서 자신에서만 나온다. 정답 라벨은 여기 들어오지 않는다.
  const rand = mulberry32(fnv1a32(entry.benchmark_id));
  const r1 = rand();
  const r2 = rand();
  const r3 = rand();
  const r4 = rand();

  const importance = sampleImportance(r1);
  const recallCount = sampleRecallCount(r3, r2);
  // 프로덕션은 last_accessed_at 이 60% null 이다 (5,432/9,055). 나머지는 0~361일.
  let lastAccessedAt: string | null = null;
  if (r4 >= 0.6) {
    const accessed = Date.now() - r2 * 361 * 86400_000;
    // 만들어지기 전에 접근된 기억은 없다.
    const createdMs = Date.parse(createdAt);
    lastAccessedAt = new Date(
      Number.isFinite(createdMs) ? Math.max(accessed, createdMs) : accessed,
    ).toISOString();
  }

  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (id, type, content, tags, created_at, importance, last_accessed_at, recall_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, entry.content, tagsJson, createdAt, importance, lastAccessedAt, recallCount]
  );

  const emb = await embeddingService.createAndStoreEmbedding(db, id, entry.content, type, provider);
  if (!emb) {
    throw new Error(
      `Failed to embed benchmark memory ${id} with provider="${provider}" (fail-closed; no silent fallback)`
    );
  }
  const providerUsed = String(emb.provider ?? '').toLowerCase();
  if (providerUsed !== provider) {
    throw new Error(
      `Benchmark corpus seed must use ${provider} embeddings (got "${emb.provider}"). ` +
        'Do not silently fall back to another provider.'
    );
  }
  const dims = Array.isArray(emb.embedding) ? emb.embedding.length : 0;
  if (dims <= 0) {
    throw new Error(`Benchmark embedding for ${id} has empty vector (provider="${provider}")`);
  }
  return dims;
}
