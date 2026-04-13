/**
 * 임베딩 맵(UMAP + K-Means) 응답 생성 (014-embedding-map-dashboard)
 */

import type Database from 'better-sqlite3';
import { UMAP } from 'umap-js';
import { logger } from '@memento/core';

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { data: EmbeddingMapResponse; expiresAt: number }>();

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
}

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

/** Lloyd's K-Means (max 100 iter). 클러스터 ID는 비결정적일 수 있음. */
export function kMeans(points: number[][], k: number, maxIter = 100): number[] {
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
    const idx = Math.floor(Math.random() * n);
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
        centroids[c] = [...points[Math.floor(Math.random() * n)]];
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

export function buildEmbeddingMapResponse(
  db: Database.Database,
  params: EmbeddingMapParams
): EmbeddingMapResponse {
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

  const vectors = parsed.map(p => p.vector);
  const nNeighbors = Math.min(15, n - 1);
  const started = Date.now();

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    nEpochs: Math.min(400, Math.max(100, n * 4)),
  });
  const coords2d = umap.fit(vectors);
  const clusterIds = kMeans(coords2d, effectiveK, 100);

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

  cache.set(cacheKey, { data: result, expiresAt: now + CACHE_TTL_MS });

  logger.info('Embedding map computed', {
    provider: params.provider,
    limit: params.limit,
    effectiveK,
    durationMs: Date.now() - started,
    pointCount: n,
  });

  return result;
}
