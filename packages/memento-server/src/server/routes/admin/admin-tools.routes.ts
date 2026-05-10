/**
 * Admin: MCP에서 제거된 운영 도구(앵커 복원, 임베딩 마이그레이션, 변환, 메타 통계)
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  RestoreAnchorsTool,
  MigrateEmbeddingsTool,
  ConvertEpisodicToSemanticTool,
  GetMetaMemoryStatsTool,
  logger,
  createToolContext
} from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';

export function registerAdminToolRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null
): void {
  router.post('/anchors/restore', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { agent_id } = req.body;

      const toolContext = createToolContext({ db, services: serverServices });
      const restoreTool = new RestoreAnchorsTool();
      const result = await restoreTool.handle({ agent_id }, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '앵커 복원 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Anchor restoration failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '앵커 복원 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/embeddings/migrate', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { source_provider, target_provider, batch_size, dry_run } = req.body;

      if (!target_provider) {
        return res.status(400).json({
          error: 'target_provider는 필수입니다'
        });
      }

      const toolContext = createToolContext({ db, services: serverServices });
      const migrateTool = new MigrateEmbeddingsTool();
      const result = await migrateTool.handle({
        source_provider,
        target_provider,
        batch_size: batch_size || 100,
        dry_run: dry_run || false
      }, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '임베딩 마이그레이션 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Embedding migration failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '임베딩 마이그레이션 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/memory/convert-episodic-to-semantic', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { memory_id, skip_converted, retry_failed, limit } = req.body;

      const toolContext = createToolContext({ db, services: serverServices });
      const convertTool = new ConvertEpisodicToSemanticTool();
      const result = await convertTool.handle({
        memory_id,
        skip_converted: skip_converted !== undefined ? skip_converted : true,
        retry_failed: retry_failed || false,
        limit: limit || 10
      }, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: 'Episodic → Semantic 변환 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Episodic to Semantic conversion failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Episodic → Semantic 변환 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/memory/meta-stats', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { memory_id, memory_ids, min_recall_count, min_confidence, limit } = req.query;

      const toolContext = createToolContext({ db, services: serverServices });
      const statsTool = new GetMetaMemoryStatsTool();

      const params: Record<string, unknown> = {};
      if (memory_id !== undefined && memory_id !== '') {
        if (typeof memory_id !== 'string') {
          return res.status(400).json({
            error: 'Invalid memory_id',
            message: 'memory_id는 단일 문자열이어야 합니다. 여러 ID는 memory_ids 쿼리를 사용하세요.'
          });
        }
        params.memory_id = memory_id;
      }
      if (memory_ids) {
        params.memory_ids = Array.isArray(memory_ids) ? memory_ids : (memory_ids as string).split(',');
      }
      if (min_recall_count) {
        const n = parseInt(min_recall_count as string, 10);
        if (Number.isNaN(n) || n < 0) {
          return res.status(400).json({ error: 'Invalid min_recall_count', message: 'min_recall_count는 0 이상의 정수여야 합니다' });
        }
        params.min_recall_count = n;
      }
      if (min_confidence) {
        const c = parseFloat(min_confidence as string);
        if (Number.isNaN(c) || c < 0 || c > 1) {
          return res.status(400).json({ error: 'Invalid min_confidence', message: 'min_confidence는 0–1 사이 숫자여야 합니다' });
        }
        params.min_confidence = c;
      }
      if (limit) {
        const l = parseInt(limit as string, 10);
        if (Number.isNaN(l) || l < 1 || l > 1000) {
          return res.status(400).json({ error: 'Invalid limit', message: 'limit는 1–1000 사이 정수여야 합니다' });
        }
        params.limit = l;
      }

      const result = await statsTool.handle(params, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '메타 메모리 통계 조회 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Meta memory stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '메타 메모리 통계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
