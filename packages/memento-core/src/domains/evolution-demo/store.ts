/**
 * In-code fixtures for evolution demo snapshots.
 * Designed for #346 to replace with DB seed later.
 */

import type { EvolutionDemoSnapshot } from './types.js';

const DEMO_QUESTION =
  'What authentication approach did we choose for the admin API?';

type SnapshotKey = `${string}:${string}`;

function key(scenarioId: string, pointId: string): SnapshotKey {
  return `${scenarioId}:${pointId}`;
}

const SNAPSHOTS: Record<SnapshotKey, EvolutionDemoSnapshot> = {
  [key('answer-over-time', 'early')]: {
    scenario_id: 'answer-over-time',
    point_id: 'early',
    point_label: 'Early (day 1)',
    question: DEMO_QUESTION,
    answer:
      'We chose JWT bearer tokens with short-lived access tokens and refresh rotation, stored in httpOnly cookies for the dashboard.',
    memory_summary: {
      episodic_count: 12,
      semantic_count: 0,
      forgotten_count: 0,
      preserved_count: 12,
      summary_text:
        'Twelve episodic memories from recent meetings; no consolidation yet.',
    },
    explanation:
      'Immediately after the decision, the agent recalls detailed episodic context from recent discussions.',
    timestamp: '2026-01-21T10:00:00.000Z',
  },
  [key('answer-over-time', 'mid')]: {
    scenario_id: 'answer-over-time',
    point_id: 'mid',
    point_label: 'Mid (day 30)',
    question: DEMO_QUESTION,
    answer:
      'JWT bearer auth with refresh rotation. Some meeting details have faded, but the core decision remains.',
    memory_summary: {
      episodic_count: 5,
      semantic_count: 2,
      forgotten_count: 5,
      preserved_count: 7,
      summary_text:
        'Five episodic memories remain; two semantic facts distilled; five low-importance episodic items forgotten.',
    },
    explanation:
      'Forgetting policy removed stale episodic noise while sleep consolidation promoted durable semantic facts.',
    timestamp: '2026-02-20T10:00:00.000Z',
  },
  [key('answer-over-time', 'late')]: {
    scenario_id: 'answer-over-time',
    point_id: 'late',
    point_label: 'Late (day 90)',
    question: DEMO_QUESTION,
    answer:
      'Admin API uses JWT bearer authentication with refresh token rotation.',
    memory_summary: {
      episodic_count: 1,
      semantic_count: 3,
      forgotten_count: 8,
      preserved_count: 4,
      summary_text:
        'Most episodic detail consolidated or forgotten; three semantic memories preserve the durable decision.',
    },
    explanation:
      'Over time, repeated recall and consolidation produce a concise semantic answer with minimal episodic overhead.',
    timestamp: '2026-04-21T10:00:00.000Z',
  },
};

export function getFixtureSnapshot(
  scenarioId: string,
  pointId: string
): EvolutionDemoSnapshot | undefined {
  return SNAPSHOTS[key(scenarioId, pointId)];
}
