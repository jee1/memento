/**
 * 관리자 /admin/relations/* 라우트
 */

import type { Request, Response, Router } from 'express';
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

type RelationType =
  | 'CAUSES'
  | 'DEPENDS_ON'
  | 'FOLLOWS'
  | 'CONTRASTS_WITH'
  | 'REFERENCES'
  | 'BELONGS_TO'
  | 'VERSION_OF';

type RelationCategory = 'Causal' | 'Temporal' | 'Structural' | 'Semantic';
type RelationDirection = 'outgoing' | 'incoming' | 'both';

const ALL_RELATION_TYPES: readonly RelationType[] = [
  'CAUSES',
  'DEPENDS_ON',
  'FOLLOWS',
  'CONTRASTS_WITH',
  'REFERENCES',
  'BELONGS_TO',
  'VERSION_OF'
];

const RELATION_CATEGORIES: readonly RelationCategory[] = ['Causal', 'Temporal', 'Structural', 'Semantic'];

function getQueryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRelationType(value: string): value is RelationType {
  return (ALL_RELATION_TYPES as readonly string[]).includes(value);
}

function isRelationCategory(value: string): value is RelationCategory {
  return (RELATION_CATEGORIES as readonly string[]).includes(value);
}

function isRelationDirection(value: string): value is RelationDirection {
  return value === 'outgoing' || value === 'incoming' || value === 'both';
}

function databaseUnavailable(res: Response) {
  return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
}

function relationToolContext(db: Database.Database) {
  return {
    db,
    services: { relationGraph: createRelationGraph(db) }
  };
}

function respondWithToolResult(res: Response, message: string, resultText: string) {
  const resultData = JSON.parse(resultText) as { success?: boolean };
  if (resultData.success === false) {
    return res.status(400).json(resultData);
  }
  return res.json({
    message,
    ...resultData,
    timestamp: new Date().toISOString()
  });
}

function postRelationExtract(db: Database.Database | null) {
  return async (req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const { memory_id, force } = req.body;

      if (!memory_id) {
        return res.status(400).json({
          error: 'memory_id는 필수입니다'
        });
      }

      const extractTool = new ExtractRelationsTool();
      const result = await extractTool.handle(
        { memory_id, force: force || false },
        relationToolContext(db)
      );

      return respondWithToolResult(res, '관계 추출 완료', result.content[0]?.text || '{}');
    } catch (error) {
      logger.error('Relation extraction failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 추출 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function getRelations(db: Database.Database | null) {
  return async (req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const memoryId = req.params.memory_id ?? '';
      const { relation_type, category, direction } = req.query;
      const relationType = getQueryString(relation_type);
      const relationCategory = getQueryString(category);
      const relationDirection = getQueryString(direction);

      const getTool = new GetRelationsTool();
      const safeDirection: RelationDirection =
        relationDirection && isRelationDirection(relationDirection) ? relationDirection : 'both';
      const result = await getTool.handle({
        memory_id: memoryId,
        ...(relationType && isRelationType(relationType) ? { relation_type: relationType } : {}),
        ...(relationCategory && isRelationCategory(relationCategory) ? { category: relationCategory } : {}),
        direction: safeDirection
      }, relationToolContext(db));

      return respondWithToolResult(res, '관계 조회 완료', result.content[0]?.text || '{}');
    } catch (error) {
      logger.error('Relation retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function postRelation(db: Database.Database | null) {
  return async (req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const { source_id, target_id, relation_type, confidence } = req.body;

      if (!source_id || !target_id || !relation_type) {
        return res.status(400).json({
          error: 'source_id, target_id, relation_type는 필수입니다'
        });
      }

      const addTool = new AddRelationTool();
      const result = await addTool.handle({
        source_id,
        target_id,
        relation_type,
        confidence
      }, relationToolContext(db));

      return respondWithToolResult(res, '관계 추가 완료', result.content[0]?.text || '{}');
    } catch (error) {
      logger.error('Relation addition failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 추가 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function deleteRelation(db: Database.Database | null) {
  return async (req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const relationIdNum = parseInt(req.params.relation_id ?? '', 10);
      if (Number.isNaN(relationIdNum) || relationIdNum < 1) {
        return res.status(400).json({
          error: 'Invalid relation_id',
          message: 'relation_id는 1 이상의 정수여야 합니다'
        });
      }

      const removeTool = new RemoveRelationTool();
      const result = await removeTool.handle({
        relation_id: relationIdNum
      }, relationToolContext(db));

      return respondWithToolResult(res, '관계 삭제 완료', result.content[0]?.text || '{}');
    } catch (error) {
      logger.error('Relation removal failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 삭제 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

function getRelationVisualization(db: Database.Database | null) {
  return async (req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const memoryId = req.params.memory_id ?? '';
      const { format, max_depth, min_confidence, relation_types, show_memory_ids, show_confidence, show_relation_types } = req.query;

      const parsedMaxDepth = max_depth ? parseInt(max_depth as string, 10) : 2;
      const parsedMinConf = min_confidence ? parseFloat(min_confidence as string) : undefined;
      if (max_depth !== undefined && (Number.isNaN(parsedMaxDepth) || parsedMaxDepth < 1 || parsedMaxDepth > 20)) {
        return res.status(400).json({ error: 'Invalid max_depth', message: 'max_depth는 1–20 사이 정수여야 합니다' });
      }
      if (min_confidence !== undefined && (parsedMinConf === undefined || Number.isNaN(parsedMinConf) || parsedMinConf < 0 || parsedMinConf > 1)) {
        return res.status(400).json({ error: 'Invalid min_confidence', message: 'min_confidence는 0–1 사이 숫자여야 합니다' });
      }

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
        memory_id: memoryId,
        format: (format as 'text' | 'subgraph' | 'simple' | 'json') || 'subgraph',
        max_depth: parsedMaxDepth,
        min_confidence: parsedMinConf,
        relation_types: parsedRelationTypes,
        show_memory_ids: show_memory_ids !== undefined ? show_memory_ids === 'true' : true,
        show_confidence: show_confidence !== undefined ? show_confidence === 'true' : true,
        show_relation_types: show_relation_types !== undefined ? show_relation_types === 'true' : true
      }, relationToolContext(db));

      return respondWithToolResult(res, '관계 시각화 완료', result.content[0]?.text || '{}');
    } catch (error) {
      logger.error('Relation visualization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 시각화 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

export function registerAdminRelationRoutes(router: Router, db: Database.Database | null): void {
  router.post('/relations/extract', postRelationExtract(db));
  router.get('/relations/:memory_id', getRelations(db));
  router.post('/relations', postRelation(db));
  router.delete('/relations/:relation_id', deleteRelation(db));
  router.get('/relations/:memory_id/visualize', getRelationVisualization(db));
}
