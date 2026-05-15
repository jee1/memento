/**
 * In-code fixtures for evolution demo snapshots.
 * Designed for #346 to replace with DB seed later.
 * Snapshot copy: Issue #394 (answer-over-time Korean demo)
 */

import { answerOverTimeFixture } from './fixtures/answer-over-time.snapshots.js';
import { forgettingPolicyFixture } from './fixtures/forgetting-policy.snapshots.js';
import type { EvolutionDemoSnapshot } from './types.js';

type SnapshotKey = `${string}:${string}`;

function key(scenarioId: string, pointId: string): SnapshotKey {
  return `${scenarioId}:${pointId}`;
}

type FixturePoint = {
  point_label: string;
  answer: string;
  memory_summary: EvolutionDemoSnapshot['memory_summary'];
  explanation: string;
  timestamp: string;
  memory_groups?: Array<{
    label: string;
    importance: number;
    status: string;
    outcome: string;
    pinned: boolean;
  }>;
};

type FixtureFile = {
  scenario_id: string;
  question: string;
  snapshots: Record<string, FixturePoint>;
};

function buildSnapshotsFromFixture(fixture: FixtureFile): Record<SnapshotKey, EvolutionDemoSnapshot> {
  const { scenario_id, question, snapshots } = fixture;
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
      ...(point.memory_groups
        ? {
            memory_groups: point.memory_groups.map(g => ({
              label: g.label,
              importance: g.importance,
              status: g.status,
              outcome: g.outcome as 'forget' | 'preserve' | 'pin',
              pinned: g.pinned,
            })),
          }
        : {}),
    };
  }

  return entries;
}

const SNAPSHOTS: Record<SnapshotKey, EvolutionDemoSnapshot> = {
  ...buildSnapshotsFromFixture(answerOverTimeFixture),
  ...buildSnapshotsFromFixture(forgettingPolicyFixture),
};

export function getFixtureSnapshot(
  scenarioId: string,
  pointId: string
): EvolutionDemoSnapshot | undefined {
  return SNAPSHOTS[key(scenarioId, pointId)];
}
