/**
 * offline 검색 품질 스크립트용: benchmark-v3 corpus.jsonl을 그대로 올린 SQLite DB를 만든다.
 * DB_PATH의 운영 DB가 아니라 코퍼스만 담은 DB에서 측정해야 CI/로컬 결과가 동일하다.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'fs';
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
  loadBenchmarkGroundTruth,
  type BenchmarkCorpusEntry,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';

const VALID_TYPES = new Set(['working', 'episodic', 'semantic', 'procedural']);

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

  const benchmarkIdToSourceId = new Map<string, string>(
    corpus.map((e) => [e.benchmark_id, e.source_memory_id])
  );

  const groundTruthPath = join(benchmarkDir, 'ground-truth.json');
  const relevantSourceIds = new Set<string>();
  if (existsSync(groundTruthPath)) {
    const groundTruth = loadBenchmarkGroundTruth(benchmarkDir);
    for (const entry of groundTruth) {
      for (const benchmarkId of entry.relevantIds) {
        const sourceId = benchmarkIdToSourceId.get(benchmarkId);
        if (sourceId) {
          relevantSourceIds.add(sourceId);
        }
      }
    }
  }

  const rand = mulberry32(42);

  const useTempDir = !options?.dbPath;
  const tmpRoot = useTempDir ? mkdtempSync(join(tmpdir(), 'memento-bench-')) : null;
  const dbPath = options?.dbPath ?? join(tmpRoot!, 'benchmark.db');

  if (options?.dbPath && existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  const db = await initializeDatabase(dbPath);
  const embeddingService = new MemoryEmbeddingService();

  try {
    for (let i = 0; i < corpus.length; i++) {
      const entry = corpus[i]!;
      const isRelevant = relevantSourceIds.has(entry.source_memory_id);
      await seedOneCorpusRow(db, embeddingService, entry, isRelevant, rand);
      if ((i + 1) % 500 === 0) {
        process.stderr.write(`[benchmark-seed] ${i + 1}/${corpus.length}\n`);
      }
    }
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

  return { db, dbPath, close };
}

async function seedOneCorpusRow(
  db: Database.Database,
  embeddingService: MemoryEmbeddingService,
  entry: BenchmarkCorpusEntry,
  isRelevant: boolean,
  rand: () => number
): Promise<void> {
  const id = entry.source_memory_id;
  const type = normalizeMemoryType(entry.type);
  const tagsJson = JSON.stringify(entry.tags ?? []);
  const createdAt = entry.created_at ?? new Date().toISOString();

  const r1 = rand();
  const r2 = rand();
  const r3 = rand();
  const r4 = rand();

  let importance: number;
  let lastAccessedAt: string | null;
  let recallCount: number;

  if (isRelevant) {
    importance = 0.7 + r1 * 0.3;
    lastAccessedAt = new Date(Date.now() - (1 + r2 * 6) * 86400_000).toISOString();
    recallCount = Math.floor(20 + r3 * 31);
  } else {
    importance = 0.1 + r1 * 0.5;
    lastAccessedAt = r4 < 0.2 ? null : new Date(Date.now() - (30 + r2 * 150) * 86400_000).toISOString();
    recallCount = Math.floor(r3 * 16);
  }

  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (id, type, content, tags, created_at, importance, last_accessed_at, recall_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, entry.content, tagsJson, createdAt, importance, lastAccessedAt, recallCount]
  );

  /** mementoConfig.embeddingProvider는 모듈 로드 시 고정되므로, 시드 시 명시적으로 TF-IDF를 요청한다 */
  const emb = await embeddingService.createAndStoreEmbedding(db, id, entry.content, type, 'tfidf');
  if (!emb) {
    throw new Error(`Failed to embed benchmark memory ${id}`);
  }
  const providerUsed = String(emb.provider ?? '').toLowerCase();
  if (providerUsed !== 'tfidf') {
    throw new Error(
      `Benchmark corpus seed must use tfidf embeddings (got "${emb.provider}"). ` +
        'TF-IDF health check must pass; do not rely on process.env after startup.'
    );
  }

  /** mock 임베딩도 저장: TF-IDF와 랭킹 상관관계가 낮아 alpha 가중치 효과를 측정 가능하게 함 */
  const mockEmb = await embeddingService.createAndStoreEmbedding(db, id, entry.content, type, 'mock');
  if (!mockEmb) {
    throw new Error(`Failed to create mock embedding for benchmark memory ${id}`);
  }
  const mockProviderUsed = String(mockEmb.provider ?? '').toLowerCase();
  if (mockProviderUsed !== 'mock') {
    throw new Error(
      `Benchmark corpus seed must store mock embeddings with provider='mock' (got "${mockEmb.provider}").`
    );
  }
}
