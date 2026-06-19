/**
 * GET /admin/graph — 기억 관계 그래프 데이터 (009-memory-graph-view)
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { logger } from '@memento/core';
import { buildGraphResponse, type GraphFilter } from './admin-graph-response.js';

export function registerAdminGraphRoute(router: Router, db: Database.Database | null): void {
  router.get('/graph', (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          error: '서비스 사용 불가',
          message: '데이터베이스에 연결되어 있지 않습니다.',
        });
      }

      const typesRaw = req.query['types'] as string | undefined;
      const relationTypesRaw = req.query['relation_types'] as string | undefined;
      const minImportanceRaw = req.query['min_importance'] as string | undefined;
      const limitRaw = req.query['limit'] as string | undefined;
      const viewRaw = req.query['view'] as string | undefined;
      const fieldsRaw = req.query['fields'] as string | undefined;

      const filters: GraphFilter = {};

      if (typesRaw) {
        const VALID_TYPES = new Set(['episodic', 'semantic', 'procedural', 'working']);
        const parsed = typesRaw.split(',').map(t => t.trim()).filter(Boolean);
        const invalid = parsed.filter(t => !VALID_TYPES.has(t));
        if (invalid.length > 0) {
          return res.status(400).json({
            error: '잘못된 파라미터',
            message: `허용되지 않는 types 값: ${invalid.join(', ')}. 허용 값: episodic, semantic, procedural, working`,
          });
        }
        filters.types = parsed;
      }
      if (relationTypesRaw) {
        filters.relation_types = relationTypesRaw.split(',').map(t => t.trim()).filter(Boolean);
      }
      if (minImportanceRaw !== undefined) {
        const val = parseFloat(minImportanceRaw);
        if (isNaN(val) || val < 0 || val > 1) {
          return res.status(400).json({ error: '잘못된 파라미터', message: 'min_importance는 0.0~1.0 사이여야 합니다' });
        }
        filters.min_importance = val;
      }
      if (viewRaw !== undefined) {
        if (viewRaw !== 'focused' && viewRaw !== 'full') {
          return res.status(400).json({ error: '잘못된 파라미터', message: 'view는 focused 또는 full이어야 합니다' });
        }
        filters.view = viewRaw;
      }
      if (fieldsRaw !== undefined) {
        if (fieldsRaw !== 'full' && fieldsRaw !== 'minimal') {
          return res.status(400).json({ error: '잘못된 파라미터', message: 'fields는 full 또는 minimal이어야 합니다' });
        }
        filters.fields = fieldsRaw;
      }
      if (limitRaw !== undefined) {
        const val = parseInt(limitRaw, 10);
        const maxLimit = filters.view === 'full' ? 5000 : 1000;
        if (isNaN(val) || val < 1 || val > maxLimit) {
          return res.status(400).json({ error: '잘못된 파라미터', message: `limit은 1~${maxLimit} 사이여야 합니다` });
        }
        filters.limit = val;
      }
      if (filters.view === 'full' && filters.fields === undefined) {
        filters.fields = 'minimal';
      }
      if (filters.view === 'full' && filters.fields === 'full') {
        return res.status(400).json({
          error: '잘못된 파라미터',
          message: 'view=full은 대용량 응답 완화를 위해 fields=minimal만 지원합니다',
        });
      }

      const graphData = buildGraphResponse(db, filters);
      return res.json(graphData);
    } catch (error) {
      logger.error('Graph data fetch failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '그래프 데이터 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
