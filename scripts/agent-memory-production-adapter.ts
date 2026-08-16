/**
 * Production recall adapter for agent-memory benchmark (#737).
 * Seeds a disposable DB with fixed fixture IDs and ranks via HybridSearchEngine
 * (same engine RecallTool / memory_injection use). Ranked IDs are taken from
 * search().items because memory_injection does not return an ID list.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeDatabase,
  createMementoCore,
  type MemoryItem,
} from '@memento/core';
import type {
  AgentMemoryBenchmarkDataset,
  AgentMemoryDocument,
} from './agent-memory-benchmark-adapter.js';

export interface ProductionRankedDocument extends AgentMemoryDocument {
  tokenEstimate: number;
}

export const FUNNEL_STAGE_ORDER = [
  'raw_text',
  'text_topN',
  'raw_vector',
  'thresholded_vector',
  'union',
  'final_top10',
] as const;

export type FunnelStageName = (typeof FUNNEL_STAGE_ORDER)[number];

export interface FunnelGoldHits {
  gold_any: boolean;
  gold_all: boolean;
  gold_fraction: number;
}

export interface FunnelStage extends FunnelGoldHits {
  name: FunnelStageName;
  candidate_count: number;
}

export interface ProductionQueryEvaluation {
  queryId: string;
  relevantIds: string[];
  ranked: ProductionRankedDocument[];
  latencyMs: number;
  funnel: FunnelStage[];
}

export interface ProductionRecallRun {
  embedding_provider: string;
  ranking_profile: string;
  production_path: 'hybridSearchEngine.search';
  imported_ids: string[];
  evaluations: ProductionQueryEvaluation[];
  ranking_version: string;
  ranking_weights_path_override: boolean;
  vector_threshold: number;
  vector_prefetch: number;
  text_weight: number;
  vector_weight: number;
  fallback_used: boolean;
}

export const DEFAULT_RANKING_PROFILE = 'default';

export function goldHitStats(candidateIds: string[], goldIds: string[]): FunnelGoldHits {
  if (goldIds.length === 0) {
    return { gold_any: false, gold_all: true, gold_fraction: 0 };
  }
  const present = new Set(candidateIds);
  const hits = goldIds.filter((id) => present.has(id)).length;
  return {
    gold_any: hits > 0,
    gold_all: hits === goldIds.length,
    gold_fraction: hits / goldIds.length,
  };
}

export function buildFunnelStages(
  idsByStage: Record<FunnelStageName, string[]>,
  goldIds: string[],
): FunnelStage[] {
  return FUNNEL_STAGE_ORDER.map((name) => {
    const candidateIds = idsByStage[name];
    return {
      name,
      candidate_count: candidateIds.length,
      ...goldHitStats(candidateIds, goldIds),
    };
  });
}

export function meanFunnelGoldFraction(
  evaluations: Array<{ funnel: FunnelStage[] }>,
  stageName: FunnelStageName,
): number {
  if (evaluations.length === 0) {
    return 0;
  }
  const total = evaluations.reduce((sum, evaluation) => {
    const stage = evaluation.funnel.find((entry) => entry.name === stageName);
    return sum + (stage?.gold_fraction ?? 0);
  }, 0);
  return total / evaluations.length;
}

export async function runProductionRecallBenchmark(
  dataset: AgentMemoryBenchmarkDataset,
  topK: number,
): Promise<ProductionRecallRun> {
  const directory = await mkdtemp(join(tmpdir(), 'memento-agent-memory-benchmark-'));
  const dbPath = join(directory, 'benchmark.db');
  let db: Awaited<ReturnType<typeof createMementoCore>>['db'] | undefined;
  let services: Awaited<ReturnType<typeof createMementoCore>>['services'] | undefined;
  let embeddingProvider = 'tfidf';

  try {
    const core = await createMementoCore({ dbPath });
    db = core.db;
    services = core.services;
    embeddingProvider = await importFixture(
      dataset.documents,
      db,
      services.embeddingService,
    );

    const documentById = new Map(dataset.documents.map((document) => [document.id, document]));
    const evaluations: ProductionQueryEvaluation[] = [];
    let vectorThreshold = 0;
    let vectorPrefetch = topK * 2;
    let textWeight = 0.4;
    let vectorWeight = 0.6;
    let fallbackUsed = false;
    const rankingVersion = services.hybridSearchEngine.getRankingVersion();

    for (const query of dataset.queries) {
      const startedAt = performance.now();
      const searchResult = await services.hybridSearchEngine.search(db, {
        query: query.query,
        limit: topK,
        filters: {
          ...(query.scopeId ? { project_id: query.scopeId } : {}),
        },
        vectorWeight: 0.6,
        textWeight: 0.4,
        includeFunnel: true,
      });
      const latencyMs = performance.now() - startedAt;
      const funnelSource = searchResult.candidate_funnel;
      if (funnelSource) {
        vectorThreshold = funnelSource.vector_threshold;
        vectorPrefetch = funnelSource.vector_prefetch;
        textWeight = funnelSource.text_weight;
        vectorWeight = funnelSource.vector_weight;
      }
      fallbackUsed = fallbackUsed || Boolean(searchResult.fallback_used);
      const ids = searchResult.items
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, topK);
      evaluations.push({
        queryId: query.id,
        relevantIds: query.relevantIds,
        ranked: ids.flatMap((id) => {
          const document = documentById.get(id);
          return document ? [{ ...document, tokenEstimate: estimateTokens(document.content) }] : [];
        }),
        latencyMs,
        funnel: funnelSource
          ? buildFunnelStages({
              raw_text: funnelSource.raw_text,
              text_topN: funnelSource.text_topN,
              raw_vector: funnelSource.raw_vector,
              thresholded_vector: funnelSource.thresholded_vector,
              union: funnelSource.union,
              final_top10: funnelSource.final_top10,
            }, query.relevantIds)
          : buildFunnelStages({
              raw_text: [],
              text_topN: [],
              raw_vector: [],
              thresholded_vector: [],
              union: [],
              final_top10: ids,
            }, query.relevantIds),
      });
    }

    return {
      embedding_provider: embeddingProvider,
      ranking_profile: DEFAULT_RANKING_PROFILE,
      production_path: 'hybridSearchEngine.search',
      imported_ids: dataset.documents.map((document) => document.id),
      evaluations,
      ranking_version: rankingVersion,
      ranking_weights_path_override: Boolean(process.env.MEMENTO_RANKING_WEIGHTS_PATH),
      vector_threshold: vectorThreshold,
      vector_prefetch: vectorPrefetch,
      text_weight: textWeight,
      vector_weight: vectorWeight,
      fallback_used: fallbackUsed,
    };
  } finally {
    if (services?.batchScheduler) {
      await services.batchScheduler.stop();
    }
    if (db) {
      closeDatabase(db);
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function importFixture(
  documents: AgentMemoryDocument[],
  db: Awaited<ReturnType<typeof createMementoCore>>['db'],
  embeddingService: Awaited<ReturnType<typeof createMementoCore>>['services']['embeddingService'],
): Promise<string> {
  const insert = db.prepare(`
    INSERT INTO memory_item (
      id, type, content, importance, created_at, session_id, project_id, origin_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let provider = 'tfidf';
  for (const document of documents) {
    insert.run(
      document.id,
      document.type,
      document.content,
      0.5,
      document.createdAt,
      document.sessionId,
      document.scopeId ?? null,
      'agent-memory-benchmark',
    );
    const stored = await embeddingService.createAndStoreEmbedding(
      db,
      document.id,
      document.content,
      document.type as MemoryItem['type'],
      'tfidf',
    );
    if (stored?.provider) {
      provider = stored.provider;
    }
  }
  return provider;
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 3));
}
