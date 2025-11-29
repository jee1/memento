/**
 * API 라우터
 * /api/* 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import { buildAnchorMapData } from '../handlers/anchor-map.handler.js';
import { MemoryNeighborService, MemoryNotFoundError } from '../../domains/memory/services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../domains/search/algorithms/vector-search-engine.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * API 라우터 생성
 */
export function createApiRouter(
  db: Database.Database | null,
  serverServices: ServerServices | null
): Router {
  const router = Router();

  // Anchor Map 조회
  router.get('/anchors/map', async (req, res) => {
    const agentId = (req.query.agent_id as string) || 'default';

    try {
      if (!db || !serverServices) {
        return res.status(500).json({
          error: 'Services not initialized',
          message: '서비스가 초기화되지 않았습니다'
        });
      }

      const anchorManager = serverServices.anchorManager;
      if (!anchorManager) {
        return res.status(500).json({
          error: 'AnchorManager not available',
          message: 'AnchorManager가 사용할 수 없습니다'
        });
      }

      // Anchor Map 데이터 생성 (핸들러 사용)
      const mapData = await buildAnchorMapData(db, serverServices, agentId);

      return res.json(mapData);
    } catch (error) {
      logger.error('Anchor Map data retrieval failed', {
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get anchor map data',
        message: error instanceof Error ? error.message : 'Unknown error',
        agent_id: agentId
      });
    }
  });

  // 메모리 이웃 조회
  router.get('/memories/:id/neighbors', async (req, res) => {
    const { id } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
    const similarityThreshold = req.query.similarity_threshold
      ? parseFloat(req.query.similarity_threshold as string)
      : 0.8;

    try {
      if (!db) {
        return res.status(500).json({
          error: 'Database not connected',
          message: '데이터베이스가 연결되지 않았습니다'
        });
      }

      // 파라미터 검증
      if (isNaN(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({
          error: 'Invalid limit parameter',
          message: 'limit은 1-50 사이의 숫자여야 합니다'
        });
      }

      if (isNaN(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
        return res.status(400).json({
          error: 'Invalid similarity_threshold parameter',
          message: 'similarity_threshold는 0-1 사이의 숫자여야 합니다'
        });
      }

      // MemoryNeighborService 사용
      if (!serverServices) {
        return res.status(500).json({
          error: 'Services not initialized',
          message: '서비스가 초기화되지 않았습니다'
        });
      }

      const vectorSearchEngine = getVectorSearchEngine();
      vectorSearchEngine.initialize(db);
      const embeddingService = serverServices.embeddingService;

      const neighborService = new MemoryNeighborService(
        vectorSearchEngine,
        embeddingService
      );
      neighborService.setDatabase(db);

      const result = await neighborService.getNeighbors(id, {
        limit,
        similarity_threshold: similarityThreshold
      });

      return res.json({
        memory_id: id,
        neighbors: result.neighbors,
        count: result.total_count,
        limit,
        similarity_threshold: similarityThreshold,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof MemoryNotFoundError) {
        return res.status(404).json({
          error: 'Memory not found',
          message: error.message,
          memory_id: id
        });
      }

      logger.error('Memory neighbors retrieval failed', {
        memoryId: id,
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get memory neighbors',
        message: error instanceof Error ? error.message : 'Unknown error',
        memory_id: id
      });
    }
  });

  return router;
}

