import { EmbeddingReindexService, type EmbeddingProvider } from '@memento/core';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { Router } from 'express';
import type { ServerServices } from '../bootstrap.js';

const EMBEDDING_PROVIDERS = new Set<EmbeddingProvider>([
  'tfidf', 'lightweight', 'minilm', 'openai', 'gemini', 'mock',
]);

type ReindexJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: Awaited<ReturnType<EmbeddingReindexService['reindex']>>;
  error?: string;
};

type BackfillRelationEndpointsJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: Awaited<ReturnType<EmbeddingReindexService['backfillSemanticRelationEndpoints']>>;
  error?: string;
};

const jobs = new Map<string, ReindexJob>();
const backfillRelationEndpointsJobs = new Map<string, BackfillRelationEndpointsJob>();

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseRequest(body: unknown): { provider: EmbeddingProvider; ownerId?: string; batchSize?: number; dryRun: boolean } | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object';
  }
  const input = body as Record<string, unknown>;
  const provider = asNonEmptyString(input.provider);
  if (!provider || !EMBEDDING_PROVIDERS.has(provider as EmbeddingProvider)) {
    return 'provider must be one of tfidf, lightweight, minilm, openai, gemini, mock';
  }
  const ownerId = input.ownerId === undefined ? undefined : asNonEmptyString(input.ownerId);
  if (input.ownerId !== undefined && !ownerId) return 'ownerId must be a non-empty string';
  const batchSize = input.batchSize === undefined ? undefined : input.batchSize;
  if (batchSize !== undefined && (typeof batchSize !== 'number' || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000)) {
    return 'batchSize must be an integer between 1 and 1000';
  }
  if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') return 'dryRun must be a boolean';
  return { provider: provider as EmbeddingProvider, ownerId, batchSize: batchSize as number | undefined, dryRun: input.dryRun === true };
}

function parseBackfillRequest(body: unknown): { provider: EmbeddingProvider; limit?: number; dryRun: boolean } | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object';
  }
  const input = body as Record<string, unknown>;
  const provider = asNonEmptyString(input.provider);
  if (!provider || !EMBEDDING_PROVIDERS.has(provider as EmbeddingProvider)) {
    return 'provider must be one of tfidf, lightweight, minilm, openai, gemini, mock';
  }
  const limit = input.limit === undefined ? undefined : input.limit;
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1_000)) {
    return 'limit must be an integer between 1 and 1000';
  }
  if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') return 'dryRun must be a boolean';
  return { provider: provider as EmbeddingProvider, limit: limit as number | undefined, dryRun: input.dryRun === true };
}

/**
 * Process-local asynchronous embedding reindex jobs. Status intentionally does
 * not survive an HTTP server restart; the durable index state remains SQLite.
 */
export function createMaintenanceRouter(db: Database.Database, serverServices: ServerServices): Router {
  const router = Router();

  router.post('/reindex', (req, res) => {
    const options = parseRequest(req.body);
    if (typeof options === 'string') return res.status(400).json({ error: options });

    const job: ReindexJob = { id: randomUUID(), status: 'queued', createdAt: new Date().toISOString() };
    jobs.set(job.id, job);
    queueMicrotask(() => {
      void (async () => {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        try {
          job.result = await new EmbeddingReindexService(db, serverServices.embeddingService).reindex(options);
          job.status = 'completed';
        } catch (error) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : 'Unknown reindex failure';
        } finally {
          job.completedAt = new Date().toISOString();
        }
      })();
    });

    return res.status(202).json({ jobId: job.id, status: job.status, statusUrl: `/api/v1/maintenance/reindex/${job.id}` });
  });

  router.get('/reindex/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Reindex job not found' });
    return res.json(job);
  });

  /**
   * #710: memory_relation의 endpoint이면서 임베딩이 없는 기존 semantic memory를
   * 제한된 개수만큼 채워 넣는 운영 진입점. `reindex`와 달리 전체 재색인이 아니라
   * n-hop 확장에 필요한 최소 backfill만 수행한다.
   */
  router.post('/backfill-relation-endpoints', (req, res) => {
    const options = parseBackfillRequest(req.body);
    if (typeof options === 'string') return res.status(400).json({ error: options });

    const job: BackfillRelationEndpointsJob = { id: randomUUID(), status: 'queued', createdAt: new Date().toISOString() };
    backfillRelationEndpointsJobs.set(job.id, job);
    queueMicrotask(() => {
      void (async () => {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        try {
          job.result = await new EmbeddingReindexService(db, serverServices.embeddingService).backfillSemanticRelationEndpoints(options);
          job.status = 'completed';
        } catch (error) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : 'Unknown backfill failure';
        } finally {
          job.completedAt = new Date().toISOString();
        }
      })();
    });

    return res.status(202).json({ jobId: job.id, status: job.status, statusUrl: `/api/v1/maintenance/backfill-relation-endpoints/${job.id}` });
  });

  router.get('/backfill-relation-endpoints/:jobId', (req, res) => {
    const job = backfillRelationEndpointsJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Backfill job not found' });
    return res.json(job);
  });

  return router;
}

export function resetMaintenanceJobsForTests(): void {
  jobs.clear();
  backfillRelationEndpointsJobs.clear();
}
