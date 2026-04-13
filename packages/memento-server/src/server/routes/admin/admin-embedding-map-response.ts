/**
 * 임베딩 맵(UMAP + K-Means) 응답 생성 (014-embedding-map-dashboard)
 */

import type Database from 'better-sqlite3';
import { UMAP } from 'umap-js';
import { logger } from '@memento/core';

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { data: EmbeddingMapResponse; expiresAt: number }>();

/** 동시 요청이 같은 cacheKey로 캐시 미스일 때 UMAP을 N번 돌리지 않도록 in-flight 공유 */
const inFlight = new Map<string, Promise<EmbeddingMapResponse>>();

export interface EmbeddingPoint {
  id: string;
  x: number;
  y: number;
  cluster: number;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  content: string;
  tags: string[];
  importance: number;
  created_at: string;
}

export interface EmbeddingMapResponse {
  points: EmbeddingPoint[];
  meta: {
    total: number;
    provider: string;
    k: number;
    requested_k: number;
    limit: number;
    cached: boolean;
    computed_at: string;
  };
}

export interface EmbeddingMapParams {
  provider: 'tfidf' | 'minilm' | 'openai' | 'gemini';
  limit: number;
  k: number;
}

const VALID_MEMORY_TYPES = new Set<string>(['episodic', 'semantic', 'procedural', 'working']);

export class EmbeddingMapBuildError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_EMBEDDINGS' | 'INSUFFICIENT_DATA' | 'CORRUPTED_EMBEDDINGS',
    public readonly payload: { provider?: string; count?: number }
  ) {
    super(message);
    this.name = 'EmbeddingMapBuildError';
  }
}

export function clearEmbeddingMapCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * 캐시/in-flight 키: `effectiveK = min(params.k, n)`만 포함.
 * 예: n=12이면 k=15·k=20 요청 모두 effectiveK=12로 동일 키 → 같은 결과·캐시(의도됨).
 */
function getCacheKey(provider: string, limit: number, effectiveK: number): string {
  return `${provider}:${limit}:${effectiveK}`;
}

function distSq(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

/** FNV-1a 32-bit — 캐시 키 등으로 K-Means 시드에 사용 */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 결정적 0~1 난수 (동일 시드 → 동일 시퀀스) */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lloyd's K-Means (max 100 iter).
 * `rng`이 있으면 초기/빈 군집 재시드가 결정적이라 캐시 만료 후에도 같은 입력에 대해 색 라벨이 안정적입니다.
 */
export function kMeans(
  points: number[][],
  k: number,
  maxIter = 100,
  rng: () => number = Math.random
): number[] {
  const n = points.length;
  if (n === 0) {
    return [];
  }
  const effK = Math.min(Math.max(1, k), n);
  const d = points[0].length;
  const centroids: number[][] = [];
  const used = new Set<number>();
  let guard = 0;
  while (centroids.length < effK && guard < n * 10) {
    guard++;
    const idx = Math.floor(rng() * n);
    if (used.has(idx)) {
      continue;
    }
    used.add(idx);
    centroids.push([...points[idx]]);
  }
  while (centroids.length < effK) {
    centroids.push([...points[centroids.length % n]]);
  }

  const assignments = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < effK; c++) {
        const ds = distSq(points[i], centroids[c]);
        if (ds < bestD) {
          bestD = ds;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const counts = new Array(effK).fill(0);
    const sums = Array.from({ length: effK }, () => new Array(d).fill(0));
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < d; j++) {
        sums[c][j] += points[i][j];
      }
    }

    for (let c = 0; c < effK; c++) {
      if (counts[c] === 0) {
        centroids[c] = [...points[Math.floor(rng() * n)]];
        continue;
      }
      for (let j = 0; j < d; j++) {
        centroids[c][j] = sums[c][j] / counts[c];
      }
    }

    if (!changed) {
      break;
    }
  }

  return assignments;
}

interface MemoryEmbeddingRow {
  id: string;
  content: string;
  type: string;
  importance: number | null;
  created_at: string | null;
  tags: string | null;
  embedding: string;
}

function parseTags(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function buildEmbeddingMapResponse(
  db: Database.Database,
  params: EmbeddingMapParams
): Promise<EmbeddingMapResponse> {
  const stmt = db.prepare(`
    SELECT
      mi.id,
      mi.content,
      mi.type,
      mi.importance,
      mi.created_at,
      mi.tags,
      me.embedding
    FROM memory_item mi
    INNER JOIN memory_embedding me
      ON me.memory_id = mi.id
      AND me.embedding_provider = ?
      AND me.projection_type = 'native'
    WHERE COALESCE(mi.is_deleted, 0) = 0
    ORDER BY COALESCE(mi.importance, 0.5) DESC, datetime(mi.created_at) DESC
    LIMIT ?
  `);

  const rows = stmt.all(params.provider, params.limit) as MemoryEmbeddingRow[];

  if (rows.length === 0) {
    throw new EmbeddingMapBuildError(
      `No embeddings for provider ${params.provider}`,
      'NO_EMBEDDINGS',
      { provider: params.provider }
    );
  }

  if (rows.length < 10) {
    throw new EmbeddingMapBuildError(
      `Insufficient memories for embedding map: ${rows.length}`,
      'INSUFFICIENT_DATA',
      { count: rows.length }
    );
  }

  const parsed: { row: MemoryEmbeddingRow; vector: number[] }[] = [];
  let dim: number | null = null;
  for (const row of rows) {
    let vec: number[];
    try {
      const raw = JSON.parse(row.embedding) as unknown;
      if (!Array.isArray(raw) || raw.length === 0) {
        continue;
      }
      vec = raw.map(x => Number(x)).filter(x => !Number.isNaN(x));
      if (vec.length === 0) {
        continue;
      }
    } catch {
      continue;
    }
    if (dim === null) {
      dim = vec.length;
    }
    if (vec.length !== dim) {
      continue;
    }
    parsed.push({ row, vector: vec });
  }

  if (parsed.length === 0) {
    throw new EmbeddingMapBuildError(
      `Corrupted or unreadable embeddings for provider ${params.provider} (${rows.length} rows)`,
      'CORRUPTED_EMBEDDINGS',
      { provider: params.provider, count: rows.length }
    );
  }

  if (parsed.length < 10) {
    throw new EmbeddingMapBuildError(
      `Insufficient memories for embedding map: ${parsed.length}`,
      'INSUFFICIENT_DATA',
      { count: parsed.length }
    );
  }

  const n = parsed.length;
  const effectiveK = Math.min(params.k, n);
  const cacheKey = getCacheKey(params.provider, params.limit, effectiveK);
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return {
      ...hit.data,
      meta: {
        ...hit.data.meta,
        cached: true,
      },
    };
  }

  const shared = inFlight.get(cacheKey);
  if (shared) {
    return await shared;
  }

  let resolve!: (value: EmbeddingMapResponse) => void;
  let reject!: (reason: unknown) => void;
  const inflightPromise = new Promise<EmbeddingMapResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  inFlight.set(cacheKey, inflightPromise);

  void (async () => {
    const started = Date.now();
    try {
      const vectors = parsed.map(p => p.vector);
      const nNeighbors = Math.min(15, n - 1);
      /**
       * UMAP 학습 스텝: 포인트 수에 비례해 늘리되 상한 400·하한 100으로 클램프.
       * (너무 작으면 수렴 부족, 너무 크면 지연만 증가)
       */
      const nEpochs = Math.min(400, Math.max(100, n * 4));

      const umap = new UMAP({
        nComponents: 2,
        nNeighbors,
        nEpochs,
      });
      const coords2d = await umap.fitAsync(vectors);
      const kmSeed = hash32(`${cacheKey}:${n}`);
      const clusterIds = kMeans(coords2d, effectiveK, 100, mulberry32(kmSeed));

      const computedAt = new Date().toISOString();
      const points: EmbeddingPoint[] = parsed.map((p, i) => {
        const t = p.row.type;
        const memType = VALID_MEMORY_TYPES.has(t)
          ? (t as EmbeddingPoint['type'])
          : 'semantic';
        return {
          id: p.row.id,
          x: coords2d[i][0]!,
          y: coords2d[i][1]!,
          cluster: clusterIds[i]!,
          type: memType,
          content: p.row.content,
          tags: parseTags(p.row.tags),
          importance: p.row.importance ?? 0.5,
          created_at: p.row.created_at ?? computedAt,
        };
      });

      const result: EmbeddingMapResponse = {
        points,
        meta: {
          total: n,
          provider: params.provider,
          k: effectiveK,
          requested_k: params.k,
          limit: params.limit,
          cached: false,
          computed_at: computedAt,
        },
      };

      cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

      logger.info('Embedding map computed', {
        provider: params.provider,
        limit: params.limit,
        effectiveK,
        durationMs: Date.now() - started,
        pointCount: n,
      });

      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  return await inflightPromise;
}
