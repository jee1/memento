import type Database from 'better-sqlite3';
import { meanPoolNormalize } from '@memento/core/domains/embedding/services/embedding-helpers.js';
import { MiniLMEmbeddingService } from '@memento/core/domains/embedding/services/minilm-embedding-service.js';
import { loadBenchmarkCorpus } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { decodeFloat32Embedding } from '@memento/core/shared/utils/embedding-serialization.js';

const VECTOR_DIMS = 384;
const VECTOR_BLOB_BYTES = VECTOR_DIMS * 4;
const REPRODUCTION_TOLERANCE = 1e-3;
const PROGRESS_INTERVAL = 100;

/** issue 1107: 문서별 mean pooling·max-sim 비교용 윈도 벡터 묶음 */
export interface MaxsimDocVectors {
  benchmarkId: string;
  memoryId: string;
  contentLength: number;
  /** meanPoolNormalize(windows) - what production stores today */
  meanVector: Float32Array;
  /** per-window normalized vectors, length >= 1 */
  windows: Float32Array[];
}

/** issue 1107: 코퍼스 재임베딩·저장 벡터 대조 통계 */
export interface MaxsimCorpusStats {
  documentCount: number;
  multiWindowDocumentCount: number;
  totalWindowVectors: number;
  maxWindowCount: number;
  /** index growth of max-sim over mean pooling, percent */
  indexGrowthPercent: number;
  /** locally recomputed meanVector vs the blob stored in memory_embedding; >0 means the harness does not reproduce production */
  reproductionMismatchCount: number;
  elapsedMs: number;
}

/** issue 1107: 쿼리 대비 mean pooling·max-sim 코사인 점수 */
export interface MaxsimScoredDoc {
  benchmarkId: string;
  meanScore: number;
  maxsimScore: number;
}

interface StoredEmbeddingRow {
  memory_id: string;
  embedding: Buffer;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i]! - b[i]!);
    if (diff > max) {
      max = diff;
    }
  }
  return max;
}

function numbersToFloat32Array(values: number[]): Float32Array {
  return Float32Array.from(values);
}

/**
 * issue 1107: 벤치마크 코퍼스를 윈도 단위로 재임베딩하고 DB에 저장된 mean 벡터와 대조한다.
 * 하이브리드 검색 엔진을 거치지 않아 임베딩 레이어 효과만 격리한다.
 */
export async function loadCorpusWindowVectors(
  db: Database.Database,
  benchmarkDir: string,
  options?: { onProgress?: (done: number, total: number) => void }
): Promise<{ docs: MaxsimDocVectors[]; stats: MaxsimCorpusStats }> {
  const started = performance.now();
  const corpus = loadBenchmarkCorpus(benchmarkDir);
  const total = corpus.length;

  const storedRows = db
    .prepare(
      `SELECT memory_id, embedding FROM memory_embedding WHERE embedding_provider = 'minilm'`
    )
    .all() as StoredEmbeddingRow[];
  const storedByMemoryId = new Map<string, Buffer>(
    storedRows.map((row) => [row.memory_id, row.embedding])
  );

  const embeddingService = new MiniLMEmbeddingService();
  const docs: MaxsimDocVectors[] = [];
  let reproductionMismatchCount = 0;
  let multiWindowDocumentCount = 0;
  let totalWindowVectors = 0;
  let maxWindowCount = 0;

  for (let index = 0; index < corpus.length; index++) {
    const entry = corpus[index]!;
    const storedBlob = storedByMemoryId.get(entry.source_memory_id);

    if (!storedBlob || storedBlob.byteLength !== VECTOR_BLOB_BYTES) {
      reproductionMismatchCount++;
    } else {
      const windowResult = await embeddingService.generateWindowEmbeddings(entry.content);
      const windows = windowResult.vectors.map((vector) => numbersToFloat32Array(vector));
      const meanVector = numbersToFloat32Array(meanPoolNormalize(windowResult.vectors));

      const storedVector = decodeFloat32Embedding(storedBlob);
      if (maxAbsDiff(meanVector, storedVector) > REPRODUCTION_TOLERANCE) {
        reproductionMismatchCount++;
      }

      const windowCount = windows.length;
      if (windowCount > 1) {
        multiWindowDocumentCount++;
      }
      totalWindowVectors += windowCount;
      if (windowCount > maxWindowCount) {
        maxWindowCount = windowCount;
      }

      docs.push({
        benchmarkId: entry.benchmark_id,
        memoryId: entry.source_memory_id,
        contentLength: entry.content.length,
        meanVector,
        windows,
      });
    }

    const done = index + 1;
    if (done % PROGRESS_INTERVAL === 0 || done === total) {
      options?.onProgress?.(done, total);
    }
  }

  const documentCount = docs.length;
  const indexGrowthPercent =
    documentCount > 0 ? ((totalWindowVectors - documentCount) / documentCount) * 100 : 0;

  return {
    docs,
    stats: {
      documentCount,
      multiWindowDocumentCount,
      totalWindowVectors,
      maxWindowCount,
      indexGrowthPercent,
      reproductionMismatchCount,
      elapsedMs: performance.now() - started,
    },
  };
}

/**
 * issue 1107: L2 정규화된 쿼리·문서 벡터에 대해 mean pooling vs max-sim 코사인 점수를 계산한다.
 */
export function scoreCorpus(queryVector: Float32Array, docs: MaxsimDocVectors[]): MaxsimScoredDoc[] {
  return docs.map((doc) => {
    let maxsimScore = Number.NEGATIVE_INFINITY;
    for (const window of doc.windows) {
      const score = dotProduct(queryVector, window);
      if (score > maxsimScore) {
        maxsimScore = score;
      }
    }

    return {
      benchmarkId: doc.benchmarkId,
      meanScore: dotProduct(queryVector, doc.meanVector),
      maxsimScore,
    };
  });
}

/**
 * issue 1107: 선택한 점수 키로 내림차순 정렬해 상위 N개 benchmark id를 반환한다.
 * 동점은 benchmarkId 오름차순으로 깨서 실행 간 결과가 결정적이다.
 */
export function rankByScore(
  scored: MaxsimScoredDoc[],
  key: 'meanScore' | 'maxsimScore',
  topN: number
): { id: string; score: number }[] {
  const ranked = [...scored].sort((left, right) => {
    const scoreDiff = right[key] - left[key];
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.benchmarkId.localeCompare(right.benchmarkId);
  });

  return ranked.slice(0, topN).map((row) => ({
    id: row.benchmarkId,
    score: row[key],
  }));
}
