/**
 * Evolution demo read accessors (fixture-backed; #346 may add DB)
 */

import { getFixtureSnapshot } from './store.js';
import {
  EvolutionDemoScenarioCatalogSchema,
  EvolutionDemoSnapshotSchema,
} from './spec.js';
import type {
  EvolutionDemoScenario,
  EvolutionDemoScenarioCatalog,
  EvolutionDemoSnapshot,
} from './types.js';

const SCENARIO_CATALOG: EvolutionDemoScenario[] = [
  {
    scenario_id: 'answer-over-time',
    title: '시간 경과에 따른 답변 변화',
    points: [
      { point_id: 'early', label: '초기 (1일차)' },
      { point_id: 'mid', label: '중기 (30일차)' },
      { point_id: 'late', label: '후기 (90일차)' },
    ],
  },
  {
    scenario_id: 'episodic-to-semantic',
    title: 'Episodic to semantic consolidation',
    points: [
      { point_id: 'before', label: 'Before consolidation' },
      { point_id: 'after', label: 'After consolidation' },
    ],
  },
];

export class EvolutionDemoNotFoundError extends Error {
  constructor(
    public readonly scenarioId: string,
    public readonly pointId?: string
  ) {
    const target = pointId ? `${scenarioId}/${pointId}` : scenarioId;
    super(`Evolution demo snapshot not found: ${target}`);
    this.name = 'EvolutionDemoNotFoundError';
  }
}

export function listEvolutionDemoScenarios(): EvolutionDemoScenarioCatalog {
  const catalog: EvolutionDemoScenarioCatalog = { scenarios: SCENARIO_CATALOG };
  EvolutionDemoScenarioCatalogSchema.parse(catalog);
  return catalog;
}

export function getEvolutionDemoSnapshot(
  scenarioId: string,
  pointId: string
): EvolutionDemoSnapshot {
  const scenario = SCENARIO_CATALOG.find(s => s.scenario_id === scenarioId);
  if (!scenario) {
    throw new EvolutionDemoNotFoundError(scenarioId);
  }
  const point = scenario.points.find(p => p.point_id === pointId);
  if (!point) {
    throw new EvolutionDemoNotFoundError(scenarioId, pointId);
  }

  const snapshot = getFixtureSnapshot(scenarioId, pointId);
  if (!snapshot) {
    throw new EvolutionDemoNotFoundError(scenarioId, pointId);
  }

  const result: EvolutionDemoSnapshot = {
    ...snapshot,
    point_label: point.label,
  };
  EvolutionDemoSnapshotSchema.parse(result);
  return result;
}
