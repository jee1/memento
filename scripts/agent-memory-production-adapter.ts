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
import { buildKnowledgeContextBundle } from '@memento/core/domains/memory/services/knowledge-context-bundle-builder.js';
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

export const BENCHMARK_EMBEDDING_PROVIDERS = ['tfidf', 'minilm'] as const;
export type BenchmarkEmbeddingProvider = (typeof BENCHMARK_EMBEDDING_PROVIDERS)[number];
export const DEFAULT_BENCHMARK_EMBEDDING_PROVIDER: BenchmarkEmbeddingProvider = 'tfidf';

export function parseBenchmarkEmbeddingProvider(value: string): BenchmarkEmbeddingProvider {
  const provider = BENCHMARK_EMBEDDING_PROVIDERS.find((candidate) => candidate === value);
  if (!provider) {
    throw new Error(`--embedding must be one of ${BENCHMARK_EMBEDDING_PROVIDERS.join(', ')} (got ${value})`);
  }
  return provider;
}

export interface BenchmarkEmbedding {
  requested_provider: BenchmarkEmbeddingProvider;
  /** Provider the stored vectors actually came from. */
  provider: string;
  model: string;
  dimensions: number;
  embedded_documents: number;
  total_documents: number;
  /** Queries per query-embedding provider the engine actually used. */
  query_providers: Record<string, number>;
  /** Queries whose query embedding fell back to tfidf. */
  query_tfidf_fallbacks: number;
}

export interface ProductionRecallRun {
  embedding: BenchmarkEmbedding;
  ranking_profile: string;
  production_path: 'hybridSearchEngine.search';
  imported_ids: string[];
  evaluations: ProductionQueryEvaluation[];
  ranking_version: string;
  ranking_weights_path_override: boolean;
  vector_threshold: number;
  ranked_vector_candidates_mean: number;
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

export function countQueriesWithCandidates(
  evaluations: Array<{ funnel: FunnelStage[] }>,
  stageName: FunnelStageName,
): number {
  return evaluations.filter((evaluation) =>
    (evaluation.funnel.find((entry) => entry.name === stageName)?.candidate_count ?? 0) > 0,
  ).length;
}

export async function runProductionRecallBenchmark(
  dataset: AgentMemoryBenchmarkDataset,
  topK: number,
  embeddingProvider: BenchmarkEmbeddingProvider = DEFAULT_BENCHMARK_EMBEDDING_PROVIDER,
): Promise<ProductionRecallRun> {
  const directory = await mkdtemp(join(tmpdir(), 'memento-agent-memory-benchmark-'));
  const dbPath = join(directory, 'benchmark.db');
  let db: Awaited<ReturnType<typeof createMementoCore>>['db'] | undefined;
  let services: Awaited<ReturnType<typeof createMementoCore>>['services'] | undefined;

  try {
    const core = await createMementoCore({ dbPath });
    db = core.db;
    services = core.services;
    const embedding = await importFixture(
      dataset.documents,
      db,
      services.embeddingService,
      embeddingProvider,
    );
    if (dataset.documents.length > 0 && embedding.embedded_documents === 0) {
      throw new Error(`No benchmark document was embedded with ${embeddingProvider}`);
    }

    const documentById = new Map(dataset.documents.map((document) => [document.id, document]));
    const evaluations: ProductionQueryEvaluation[] = [];
    let vectorThreshold = 0;
    let vectorPrefetch = topK * 2;
    let textWeight = 0.4;
    let vectorWeight = 0.6;
    let fallbackUsed = false;
    const queryProviders: Record<string, number> = {};
    let queryTfidfFallbacks = 0;
    let rankedVectorCandidates = 0;
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
      const queryProviderKey = (searchResult.query_embedding_providers ?? []).join('+') || 'none';
      queryProviders[queryProviderKey] = (queryProviders[queryProviderKey] ?? 0) + 1;
      rankedVectorCandidates += searchResult.vector_count ?? 0;
      if (searchResult.tfidf_query_embedding_fallback) {
        queryTfidfFallbacks++;
      }
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
      embedding: {
        ...embedding,
        query_providers: queryProviders,
        query_tfidf_fallbacks: queryTfidfFallbacks,
      },
      ranking_profile: DEFAULT_RANKING_PROFILE,
      production_path: 'hybridSearchEngine.search',
      imported_ids: dataset.documents.map((document) => document.id),
      evaluations,
      ranking_version: rankingVersion,
      ranking_weights_path_override: Boolean(process.env.MEMENTO_RANKING_WEIGHTS_PATH),
      vector_threshold: vectorThreshold,
      ranked_vector_candidates_mean: dataset.queries.length > 0 ? rankedVectorCandidates / dataset.queries.length : 0,
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

const INJECTION_CONTENT_NEEDLE_CHARS = 24;
const INJECTION_MAX_MEMORIES = 5;

export const ENABLE_READER_ARMS = false;

export function selectedIdsFromInjectionPrompt(
  promptText: string,
  documents: AgentMemoryDocument[],
): string[] {
  return documents
    .filter((document) => {
      const needle = document.content.trim().slice(0, INJECTION_CONTENT_NEEDLE_CHARS);
      return needle.length > 0 && promptText.includes(needle);
    })
    .map((document) => document.id);
}

export interface ProductionInjectionEvaluation {
  queryId: string;
  relevantIds: string[];
  engine_ids: string[];
  selected_ids: string[];
  prompt_text: string;
  serialized_token_estimate: number;
  fixed_item_gold_fraction: number;
  fixed_token_gold_fraction: number;
  latencyMs: number;
}

export interface ProductionInjectionRun {
  production_path: 'buildKnowledgeContextBundle';
  requested_token_budget: number;
  evaluations: ProductionInjectionEvaluation[];
  reader_arms?: undefined;
}

export async function runProductionInjectionBenchmark(
  dataset: AgentMemoryBenchmarkDataset,
  options: { topK: number; tokenBudget: number },
): Promise<ProductionInjectionRun> {
  const directory = await mkdtemp(join(tmpdir(), 'memento-agent-memory-injection-'));
  const dbPath = join(directory, 'benchmark.db');
  let db: Awaited<ReturnType<typeof createMementoCore>>['db'] | undefined;
  let services: Awaited<ReturnType<typeof createMementoCore>>['services'] | undefined;

  try {
    const core = await createMementoCore({ dbPath });
    db = core.db;
    services = core.services;
    await importFixture(
      dataset.documents,
      db,
      services.embeddingService,
      DEFAULT_BENCHMARK_EMBEDDING_PROVIDER,
    );
    void options.topK;

    const evaluations: ProductionInjectionEvaluation[] = [];
    for (const query of dataset.queries) {
      const projectId = query.scopeId;
      const hasScope = typeof projectId === 'string' && projectId.length > 0;
      let engineIds: string[] = [];
      const search = services.hybridSearchEngine.search.bind(services.hybridSearchEngine);
      services.hybridSearchEngine.search = (async (dbArg, searchQuery) => {
        const result = await search(dbArg, searchQuery);
        engineIds = result.items
          .map((item) => item.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        return result;
      }) as typeof services.hybridSearchEngine.search;
      const startedAt = performance.now();
      try {
        const bundle = await buildKnowledgeContextBundle(
          {
            db,
            hybridSearchEngine: services.hybridSearchEngine,
          },
          {
            query: query.query,
            tokenBudget: options.tokenBudget,
            maxMemories: INJECTION_MAX_MEMORIES,
            projectId: hasScope ? projectId : undefined,
          },
        );
        const selectedIds = selectedIdsFromInjectionPrompt(bundle.promptText, dataset.documents);
        evaluations.push({
          queryId: query.id,
          relevantIds: query.relevantIds,
          engine_ids: engineIds,
          selected_ids: selectedIds,
          prompt_text: bundle.promptText,
          serialized_token_estimate: bundle.tokenEstimate,
          fixed_item_gold_fraction: goldHitStats(
            engineIds.slice(0, INJECTION_MAX_MEMORIES),
            query.relevantIds,
          ).gold_fraction,
          fixed_token_gold_fraction: goldHitStats(selectedIds, query.relevantIds).gold_fraction,
          latencyMs: performance.now() - startedAt,
        });
      } finally {
        services.hybridSearchEngine.search = search;
      }
    }

    return {
      production_path: 'buildKnowledgeContextBundle',
      requested_token_budget: options.tokenBudget,
      evaluations,
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
  requestedProvider: BenchmarkEmbeddingProvider,
): Promise<Omit<BenchmarkEmbedding, 'query_providers' | 'query_tfidf_fallbacks'>> {
  const insert = db.prepare(`
    INSERT INTO memory_item (
      id, type, content, importance, created_at, session_id, project_id, origin_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const providers = new Set<string>();
  let model = '';
  let dimensions = 0;
  let embeddedDocuments = 0;
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
      requestedProvider,
    );
    if (stored) {
      embeddedDocuments++;
      providers.add(stored.provider ?? requestedProvider);
      model = stored.model;
      dimensions = stored.embedding.length;
    }
  }
  if (embeddedDocuments < documents.length) {
    process.stderr.write(
      `[agent-memory-benchmark] ${documents.length - embeddedDocuments}/${documents.length} documents were not embedded with ${requestedProvider}\n`,
    );
  }
  return {
    requested_provider: requestedProvider,
    provider: [...providers].sort().join('+'),
    model,
    dimensions,
    embedded_documents: embeddedDocuments,
    total_documents: documents.length,
  };
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 3));
}
