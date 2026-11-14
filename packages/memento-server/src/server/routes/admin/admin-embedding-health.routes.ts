/**
 * GET /admin/embedding-health — 임베딩 진단/문제 목록
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  EmbeddingReindexService,
  type EmbeddingHealthOptions,
  type EmbeddingHealthProblem,
  type MemoryItem,
} from '@memento/core';

const VALID_PROVIDERS = new Set(['tfidf', 'minilm', 'openai', 'gemini']);
const VALID_MEMORY_TYPES = new Set<MemoryItem['type']>(['working', 'episodic', 'semantic', 'procedural']);
const VALID_PROBLEMS = new Set<EmbeddingHealthProblem>([
  'missing_embedding',
  'unreadable_embedding',
  'dimension_mismatch',
  'provider_drift',
  'model_drift',
]);

function parseHealthParams(query: Record<string, unknown>):
  | (EmbeddingHealthOptions & { problem?: EmbeddingHealthProblem; limit: number; offset: number })
  | { error: string; message: string } {
  const provider = typeof query['provider'] === 'string' ? query['provider'] : 'minilm';
  const type = typeof query['type'] === 'string' ? query['type'] : undefined;
  const problem = typeof query['problem'] === 'string' ? query['problem'] : undefined;
  const limit = query['limit'] === undefined ? 50 : Number(query['limit']);
  const offset = query['offset'] === undefined ? 0 : Number(query['offset']);

  if (!VALID_PROVIDERS.has(provider)) {
    return { error: '잘못된 파라미터', message: '지원하지 않는 provider입니다' };
  }
  if (type !== undefined && !VALID_MEMORY_TYPES.has(type as MemoryItem['type'])) {
    return { error: '잘못된 파라미터', message: '지원하지 않는 memory type입니다' };
  }
  if (problem !== undefined && !VALID_PROBLEMS.has(problem as EmbeddingHealthProblem)) {
    return { error: '잘못된 파라미터', message: '지원하지 않는 problem입니다' };
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    return { error: '잘못된 파라미터', message: 'limit은 1~100, offset은 0 이상의 정수여야 합니다' };
  }

  return {
    provider: provider as EmbeddingHealthOptions['provider'],
    ownerId: typeof query['owner_id'] === 'string' && query['owner_id'] ? query['owner_id'] : undefined,
    projectId: typeof query['project_id'] === 'string' && query['project_id'] ? query['project_id'] : undefined,
    type: type as MemoryItem['type'] | undefined,
    problem: problem as EmbeddingHealthProblem | undefined,
    limit,
    offset,
  };
}

export function registerAdminEmbeddingHealthRoute(router: Router, db: Database.Database | null): void {
  const healthService = db ? new EmbeddingReindexService(db) : null;

  router.get('/embedding-health', (req, res) => {
    if (!healthService) {
      return res.status(503).json({
        error: '서비스 사용 불가',
        message: '데이터베이스에 연결되어 있지 않습니다.',
      });
    }
    const parsed = parseHealthParams(req.query as Record<string, unknown>);
    if ('error' in parsed) {
      return res.status(400).json(parsed);
    }
    if (parsed.problem) {
      return res.json(healthService.listProblems({ ...parsed, problem: parsed.problem }));
    }
    return res.json({ diagnostics: healthService.diagnose(parsed) });
  });
}
