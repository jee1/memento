/**
 * 관리자 /admin/relations/* 라우트
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  createRelationGraph,
  ExtractRelationsTool,
  GetRelationsTool,
  AddRelationTool,
  RemoveRelationTool,
  VisualizeRelationsTool,
  logger
} from '@memento/core';

export function registerAdminRelationRoutes(router: Router, db: Database.Database | null): void {
  router.post('/relations/extract', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { memory_id, force } = req.body;

      if (!memory_id) {
        return res.status(400).json({
          error: 'memory_id는 필수입니다'
        });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const extractTool = new ExtractRelationsTool();
      const result = await extractTool.handle({ memory_id, force: force || false }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 추출 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation extraction failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 추출 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/relations/:memory_id', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { memory_id } = req.params;
      const { relation_type, category, direction } = req.query;

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const getTool = new GetRelationsTool();
      const result = await getTool.handle({
        memory_id,
        relation_type: relation_type as any,
        category: category as any,
        direction: (direction as any) || 'both'
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 조회 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/relations', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { source_id, target_id, relation_type, confidence } = req.body;

      if (!source_id || !target_id || !relation_type) {
        return res.status(400).json({
          error: 'source_id, target_id, relation_type는 필수입니다'
        });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const addTool = new AddRelationTool();
      const result = await addTool.handle({
        source_id,
        target_id,
        relation_type,
        confidence: confidence || 0.7
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 추가 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation addition failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 추가 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.delete('/relations/:relation_id', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { relation_id } = req.params;
      const relationIdNum = parseInt(relation_id, 10);
      if (Number.isNaN(relationIdNum) || relationIdNum < 1) {
        return res.status(400).json({
          error: 'Invalid relation_id',
          message: 'relation_id는 1 이상의 정수여야 합니다'
        });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const removeTool = new RemoveRelationTool();
      const result = await removeTool.handle({
        relation_id: relationIdNum
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 삭제 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation removal failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 삭제 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/relations/:memory_id/visualize', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { memory_id } = req.params;
      const { format, max_depth, min_confidence, relation_types, show_memory_ids, show_confidence, show_relation_types } = req.query;

      const parsedMaxDepth = max_depth ? parseInt(max_depth as string, 10) : 2;
      const parsedMinConf = min_confidence ? parseFloat(min_confidence as string) : undefined;
      if (max_depth !== undefined && (Number.isNaN(parsedMaxDepth) || parsedMaxDepth < 1 || parsedMaxDepth > 20)) {
        return res.status(400).json({ error: 'Invalid max_depth', message: 'max_depth는 1–20 사이 정수여야 합니다' });
      }
      if (min_confidence !== undefined && (parsedMinConf === undefined || Number.isNaN(parsedMinConf) || parsedMinConf < 0 || parsedMinConf > 1)) {
        return res.status(400).json({ error: 'Invalid min_confidence', message: 'min_confidence는 0–1 사이 숫자여야 합니다' });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const validRelationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'] as const;
      const parsedRelationTypes = relation_types
        ? (relation_types as string)
            .split(',')
            .map((type: string) => type.trim().toUpperCase())
            .filter((type: string): type is typeof validRelationTypes[number] =>
              validRelationTypes.includes(type as typeof validRelationTypes[number])
            )
        : undefined;

      const visualizeTool = new VisualizeRelationsTool();
      const result = await visualizeTool.handle({
        memory_id,
        format: (format as 'text' | 'subgraph' | 'simple' | 'json') || 'subgraph',
        max_depth: parsedMaxDepth,
        min_confidence: parsedMinConf,
        relation_types: parsedRelationTypes,
        show_memory_ids: show_memory_ids !== undefined ? show_memory_ids === 'true' : true,
        show_confidence: show_confidence !== undefined ? show_confidence === 'true' : true,
        show_relation_types: show_relation_types !== undefined ? show_relation_types === 'true' : true
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 시각화 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation visualization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 시각화 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
