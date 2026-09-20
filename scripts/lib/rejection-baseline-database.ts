/**
 * #922 rejection baseline: benchmark-v3 parent corpus + synthetic overlay rows.
 * Seeding reuses benchmark-search-database neutral metadata (#973).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  closeDatabase,
  initializeDatabase,
  MemoryEmbeddingService,
} from '@memento/core';
import {
  createSeededBenchmarkDatabase,
  seedOneCorpusRow,
  type SeededBenchmarkDb,
} from './benchmark-search-database.js';
import {
  loadBenchmarkCorpus,
  type BenchmarkCorpusEntry,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { resolveBenchmarkEmbeddingProvider } from '@memento/core/shared/types/benchmark.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export const BENCHMARK_V3_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
export const REJECTION_BASELINE_DIR = join(
  ROOT,
  'tests/fixtures/search-quality/rejection-baseline'
);

const UNIT_TEST_DISTRACTORS: BenchmarkCorpusEntry[] = [
  {
    benchmark_id: 'rej_noise_0001',
    source_memory_id: 'rej_noise_mem_0001',
    type: 'semantic',
    tags: ['fixture', 'rejection-baseline'],
    created_at: '2026-01-02T00:00:01.000Z',
    content: '김치찌개는 배추·고춧가루·두부로 끓이는 한식 요리다.',
  },
  {
    benchmark_id: 'rej_noise_0002',
    source_memory_id: 'rej_noise_mem_0002',
    type: 'episodic',
    tags: ['fixture', 'rejection-baseline'],
    created_at: '2026-01-02T00:00:02.000Z',
    content: '오늘 저녁 메뉴를 고르는 일상적인 고민 메모.',
  },
  {
    benchmark_id: 'rej_noise_0003',
    source_memory_id: 'rej_noise_mem_0003',
    type: 'semantic',
    tags: ['fixture', 'rejection-baseline'],
    created_at: '2026-01-02T00:00:03.000Z',
    content: '내일 비가 오는지 확인하는 날씨 메모.',
  },
];

export function loadRejectionBaselineOverlay(baselineDir = REJECTION_BASELINE_DIR): BenchmarkCorpusEntry[] {
  const overlayPath = join(baselineDir, 'corpus-overlay.jsonl');
  if (!existsSync(overlayPath)) {
    throw new Error(`Rejection baseline overlay not found: ${overlayPath}`);
  }
  const lines = readFileSync(overlayPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as BenchmarkCorpusEntry;
    } catch (error) {
      throw new Error(
        `Invalid overlay JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

async function seedCorpusRows(
  db: Awaited<ReturnType<typeof initializeDatabase>>,
  entries: BenchmarkCorpusEntry[],
  provider: ReturnType<typeof resolveBenchmarkEmbeddingProvider>
): Promise<{ vectorDims: number; seededCount: number }> {
  const embeddingService = new MemoryEmbeddingService();
  let vectorDims = 0;
  let seededCount = 0;
  for (const entry of entries) {
    const dims = await seedOneCorpusRow(db, embeddingService, entry, provider);
    if (vectorDims === 0) {
      vectorDims = dims;
    }
    seededCount++;
  }
  if (vectorDims <= 0) {
    throw new Error(`Rejection baseline seed produced no embeddings for provider="${provider}"`);
  }
  return { vectorDims, seededCount };
}

/**
 * Small synthetic corpus for unit tests (overlay + neutral distractors only).
 */
export async function createRejectionBaselineUnitTestDatabase(
  options?: { dbPath?: string }
): Promise<SeededBenchmarkDb & { overlayCount: number; parentDocumentCount: number }> {
  const provider = resolveBenchmarkEmbeddingProvider();
  const overlay = loadRejectionBaselineOverlay();
  const corpus = [...overlay, ...UNIT_TEST_DISTRACTORS];

  const useTempDir = !options?.dbPath;
  const tmpRoot = useTempDir ? mkdtempSync(join(tmpdir(), 'memento-rb-unit-')) : null;
  const dbPath = options?.dbPath ?? join(tmpRoot!, 'rejection-baseline-unit.db');

  const db = await initializeDatabase(dbPath);
  try {
    const { vectorDims } = await seedCorpusRows(db, corpus, provider);
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
    process.stderr.write(
      `[rejection-baseline-seed] unit-test corpus=${corpus.length} overlay=${overlay.length} provider=${provider}\n`
    );
    return {
      db,
      dbPath,
      close,
      embeddingProvider: provider,
      vectorDims,
      relationCount: 0,
      overlayCount: overlay.length,
      parentDocumentCount: UNIT_TEST_DISTRACTORS.length,
    };
  } catch (error) {
    closeDatabase(db);
    if (useTempDir && tmpRoot) {
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    throw error;
  }
}

/**
 * Seeds benchmark-v3 then overlay documents. Overlay source_memory_id collisions are skipped
 * (parent snapshot already contains the row).
 */
export async function createRejectionBaselineDatabase(
  options?: { dbPath?: string }
): Promise<SeededBenchmarkDb & { overlayCount: number; parentDocumentCount: number }> {
  const seeded = await createSeededBenchmarkDatabase(BENCHMARK_V3_DIR, options);
  const overlay = loadRejectionBaselineOverlay();
  const parentCount = loadBenchmarkCorpus(BENCHMARK_V3_DIR).length;
  const parentIds = new Set(loadBenchmarkCorpus(BENCHMARK_V3_DIR).map((entry) => entry.source_memory_id));
  const embeddingService = new MemoryEmbeddingService();

  let overlayCount = 0;
  try {
    for (const entry of overlay) {
      if (parentIds.has(entry.source_memory_id)) {
        continue;
      }
      await seedOneCorpusRow(seeded.db, embeddingService, entry, seeded.embeddingProvider);
      overlayCount++;
    }
  } catch (error) {
    seeded.close();
    throw error;
  }

  process.stderr.write(
    `[rejection-baseline-seed] parent=benchmark-v3 parent_docs=${parentCount} overlay=${overlayCount} provider=${seeded.embeddingProvider}\n`
  );

  return { ...seeded, overlayCount, parentDocumentCount: parentCount };
}
