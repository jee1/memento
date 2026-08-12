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

export interface ProductionQueryEvaluation {
  queryId: string;
  relevantIds: string[];
  ranked: ProductionRankedDocument[];
  latencyMs: number;
}

export interface ProductionRecallRun {
  embedding_provider: string;
  ranking_profile: string;
  production_path: 'hybridSearchEngine.search';
  imported_ids: string[];
  evaluations: ProductionQueryEvaluation[];
}

export const DEFAULT_RANKING_PROFILE = 'default';

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
      });
      const latencyMs = performance.now() - startedAt;
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
      });
    }

    return {
      embedding_provider: embeddingProvider,
      ranking_profile: DEFAULT_RANKING_PROFILE,
      production_path: 'hybridSearchEngine.search',
      imported_ids: dataset.documents.map((document) => document.id),
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
