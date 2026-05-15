/**
 * In-code fixtures for evolution demo snapshots.
 * Designed for #346 to replace with DB seed later.
 * Snapshot copy: Issue #394 (answer-over-time Korean demo)
 */

import answerOverTimeFixture from './fixtures/answer-over-time.snapshots.json' with { type: 'json' };
import type { EvolutionDemoSnapshot } from './types.js';

type SnapshotKey = `${string}:${string}`;

function key(scenarioId: string, pointId: string): SnapshotKey {
  return `${scenarioId}:${pointId}`;
}

function buildAnswerOverTimeSnapshots(): Record<SnapshotKey, EvolutionDemoSnapshot> {
  const { scenario_id, question, snapshots } = answerOverTimeFixture;
  const entries: Record<SnapshotKey, EvolutionDemoSnapshot> = {};

  for (const [pointId, point] of Object.entries(snapshots)) {
    entries[key(scenario_id, pointId)] = {
      scenario_id,
      point_id: pointId,
      point_label: point.point_label,
      question,
      answer: point.answer,
      memory_summary: point.memory_summary,
      explanation: point.explanation,
      timestamp: point.timestamp,
    };
  }

  return entries;
}

const SNAPSHOTS: Record<SnapshotKey, EvolutionDemoSnapshot> = {
  ...buildAnswerOverTimeSnapshots(),
};

export function getFixtureSnapshot(
  scenarioId: string,
  pointId: string
): EvolutionDemoSnapshot | undefined {
  return SNAPSHOTS[key(scenarioId, pointId)];
}
