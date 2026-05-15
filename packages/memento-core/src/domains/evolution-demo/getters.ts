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
    title: 'Answer changes over time',
    points: [
      { point_id: 'early', label: 'Early (day 1)' },
      { point_id: 'mid', label: 'Mid (day 30)' },
      { point_id: 'late', label: 'Late (day 90)' },
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
  return EvolutionDemoScenarioCatalogSchema.parse(catalog);
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

  return EvolutionDemoSnapshotSchema.parse({
    ...snapshot,
    point_label: point.label,
  });
}
