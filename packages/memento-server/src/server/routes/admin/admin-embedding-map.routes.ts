/**
 * GET /admin/embedding-map — 임베딩 2D 맵 (014-embedding-map-dashboard)
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { logger } from '@memento/core';
import {
  buildEmbeddingMapResponse,
  EmbeddingMapBuildError,
  type EmbeddingMapParams,
} from './admin-embedding-map-response.js';

const VALID_PROVIDERS = new Set(['tfidf', 'minilm', 'openai', 'gemini']);

function parseParams(
  query: Record<string, unknown>
): EmbeddingMapParams | { error: string; message: string } {
  const providerRaw = typeof query['provider'] === 'string' ? query['provider'] : 'minilm';
  const limitRaw = query['limit'] !== undefined ? String(query['limit']) : '300';
  const kRaw = query['k'] !== undefined ? String(query['k']) : '6';

  if (!VALID_PROVIDERS.has(providerRaw)) {
    return {
      error: '잘못된 파라미터',
      message: 'provider는 tfidf, minilm, openai, gemini 중 하나여야 합니다',
    };
  }

  const limit = parseInt(limitRaw, 10);
  if (Number.isNaN(limit) || limit < 1 || limit > 500) {
    return {
      error: '잘못된 파라미터',
      message: 'limit은 1~500 사이 정수여야 합니다',
    };
  }

  const k = parseInt(kRaw, 10);
  if (Number.isNaN(k) || k < 2 || k > 20) {
    return {
      error: '잘못된 파라미터',
      message: 'k는 2~20 사이 정수여야 합니다',
    };
  }

  return {
    provider: providerRaw as EmbeddingMapParams['provider'],
    limit,
    k,
  };
}

export function registerAdminEmbeddingMapRoute(router: Router, db: Database.Database | null): void {
  router.get('/embedding-map', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ error: 'Service unavailable' });
      }

      const parsed = parseParams(req.query as Record<string, unknown>);
      if ('error' in parsed) {
        return res.status(400).json(parsed);
      }

      const result = await buildEmbeddingMapResponse(db, parsed);
      return res.json(result);
    } catch (error) {
      if (error instanceof EmbeddingMapBuildError) {
        if (error.code === 'INSUFFICIENT_DATA') {
          const count = error.payload.count ?? 0;
          return res.status(400).json({
            error: '기억 부족',
            message: `임베딩 맵을 그리려면 최소 10개의 기억이 필요합니다. (현재 ${count}개)`,
            count,
          });
        }
        if (error.code === 'NO_EMBEDDINGS') {
          const provider = error.payload.provider ?? 'unknown';
          return res.status(400).json({
            error: '임베딩 없음',
            message: `${provider} 임베딩이 아직 없습니다. 기억을 더 저장하면 자동 생성됩니다.`,
            provider,
          });
        }
        if (error.code === 'CORRUPTED_EMBEDDINGS') {
          const provider = error.payload.provider ?? 'unknown';
          const rowCount = error.payload.count ?? 0;
          return res.status(500).json({
            error: '임베딩 데이터 손상',
            message:
              '저장된 임베딩 벡터를 파싱할 수 없습니다. DB 정합성(embedding JSON)을 확인하세요.',
            code: 'CORRUPTED_EMBEDDINGS',
            provider,
            rowCount,
          });
        }
      }

      logger.error('Embedding map failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: '임베딩 맵 계산 실패',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
