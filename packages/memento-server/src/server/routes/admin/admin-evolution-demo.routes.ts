/**
 * Admin: evolution demo snapshot read API (Issue #341)
 */

import type { Router } from 'express';
import { logger } from '@memento/core';
import {
  getEvolutionDemoSnapshot,
  listEvolutionDemoScenarios,
  EvolutionDemoNotFoundError,
} from './evolution-demo/index.js';

export function registerAdminEvolutionDemoRoutes(router: Router): void {
  router.get('/evolution-demo/scenarios', (_req, res) => {
    try {
      const catalog = listEvolutionDemoScenarios();
      return res.json(catalog);
    } catch (error) {
      logger.error('evolution-demo scenarios failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: '시나리오 목록 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  router.get('/evolution-demo/snapshots/:scenario_id/:point_id', (req, res) => {
    try {
      const { scenario_id, point_id } = req.params;
      if (!scenario_id || !point_id) {
        return res.status(400).json({ error: 'scenario_id와 point_id가 필요합니다' });
      }

      const snapshot = getEvolutionDemoSnapshot(scenario_id, point_id);
      return res.json(snapshot);
    } catch (error) {
      if (error instanceof EvolutionDemoNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      logger.error('evolution-demo snapshot failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: '스냅샷 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
