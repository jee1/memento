/**
 * offline 검색 품질 스크립트용: benchmark-v3 corpus.jsonl을 그대로 올린 SQLite DB를 만든다.
 * DB_PATH의 운영 DB가 아니라 코퍼스만 담은 DB에서 측정해야 CI/로컬 결과가 동일하다.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeDatabase, initializeDatabase } from '@memento/core/infrastructure/database/database/init.js';
import { MemoryEmbeddingService } from '@memento/core/domains/memory/services/memory-embedding-service.js';
import { DatabaseUtils } from '@memento/core/shared/utils/database.js';
import {
  loadBenchmarkCorpus,
  type BenchmarkCorpusEntry,
} from './search-quality-benchmark-fixtures.js';
import type { MemoryType } from '@memento/core/index.js';

const VALID_TYPES = new Set(['working', 'episodic', 'semantic', 'procedural']);

function normalizeMemoryType(type: string): MemoryType {
  if (VALID_TYPES.has(type)) {
    return type as MemoryType;
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
      await seedOneCorpusRow(db, embeddingService, entry);
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
  entry: BenchmarkCorpusEntry
): Promise<void> {
  const id = entry.source_memory_id;
  const type = normalizeMemoryType(entry.type);
  const tagsJson = JSON.stringify(entry.tags ?? []);
  const createdAt = entry.created_at ?? new Date().toISOString();

  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (id, type, content, tags, created_at, importance) VALUES (?, ?, ?, ?, ?, 0.5)`,
    [id, type, entry.content, tagsJson, createdAt]
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
}
