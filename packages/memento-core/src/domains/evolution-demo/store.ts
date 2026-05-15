/**
 * In-code fixtures for evolution demo snapshots.
 * Designed for #346 to replace with DB seed later.
 */

import type { EvolutionDemoEpisodicSource, EvolutionDemoSnapshot } from './types.js';

const DEMO_QUESTION =
  'What authentication approach did we choose for the admin API?';

const CONSOLIDATION_QUESTION =
  'How should we secure the admin API endpoints?';

const EPISODIC_SOURCES: EvolutionDemoEpisodicSource[] = [
  {
    id: 'mem_ep_001',
    summary:
      'Sprint planning: team discussed JWT vs session cookies; JWT chosen for stateless admin API.',
    created_at: '2026-01-10T09:00:00.000Z',
    importance: 0.7,
  },
  {
    id: 'mem_ep_002',
    summary:
      'Architecture review: refresh token rotation required; store tokens in httpOnly cookies.',
    created_at: '2026-01-12T14:30:00.000Z',
    importance: 0.8,
  },
  {
    id: 'mem_ep_003',
    summary:
      'Security standup: short-lived access tokens (15 min) with sliding refresh window.',
    created_at: '2026-01-15T11:00:00.000Z',
    importance: 0.75,
  },
  {
    id: 'mem_ep_004',
    summary:
      'Dashboard demo: bearer token in Authorization header for API calls from SPA.',
    created_at: '2026-01-18T16:00:00.000Z',
    importance: 0.6,
  },
];

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
  [key('episodic-to-semantic', 'before')]: {
    scenario_id: 'episodic-to-semantic',
    point_id: 'before',
    point_label: 'Before consolidation',
    question: CONSOLIDATION_QUESTION,
    answer:
      'From recent meetings: JWT was chosen in sprint planning; refresh rotation and httpOnly cookies were discussed in architecture review; 15-minute access tokens came up in security standup; the dashboard uses bearer tokens in the Authorization header.',
    memory_summary: {
      episodic_count: 4,
      semantic_count: 0,
      forgotten_count: 0,
      preserved_count: 4,
      summary_text:
        'Four separate episodic memories hold fragments of the auth decision; no semantic consolidation yet.',
    },
    explanation:
      'Recall returns multiple episodic hits with overlapping but fragmented detail. The agent must synthesize across sources.',
    timestamp: '2026-01-20T10:00:00.000Z',
    episodic_sources: EPISODIC_SOURCES,
    search_comparison: {
      before_summary:
        '4 episodic memories (sprint planning, architecture review, security standup, dashboard demo); fragmented JWT details.',
      after_summary:
        '4 episodic memories (sprint planning, architecture review, security standup, dashboard demo); fragmented JWT details.',
    },
  },
  [key('episodic-to-semantic', 'after')]: {
    scenario_id: 'episodic-to-semantic',
    point_id: 'after',
    point_label: 'After consolidation',
    question: CONSOLIDATION_QUESTION,
    answer:
      'Secure admin API endpoints with JWT bearer authentication: short-lived access tokens (15 min), refresh token rotation, tokens stored in httpOnly cookies, and bearer tokens in the Authorization header for SPA calls.',
    memory_summary: {
      episodic_count: 4,
      semantic_count: 1,
      forgotten_count: 0,
      preserved_count: 5,
      summary_text:
        'Four episodic sources distilled into one semantic memory capturing the durable auth policy.',
    },
    explanation:
      'Sleep consolidation merged overlapping episodic fragments into a single semantic fact. Search now surfaces one authoritative answer.',
    timestamp: '2026-01-22T06:00:00.000Z',
    episodic_sources: EPISODIC_SOURCES,
    semantic_result: {
      id: 'mem_sem_001',
      summary:
        'Admin API auth policy: JWT bearer tokens, 15-minute access tokens, refresh rotation, httpOnly cookie storage, Authorization header for SPA.',
      source_count: 4,
      explanation:
        'Consolidated from four episodic memories covering sprint planning, architecture review, security standup, and dashboard integration.',
    },
    search_comparison: {
      before_summary:
        '4 episodic memories (sprint planning, architecture review, security standup, dashboard demo); fragmented JWT details.',
      after_summary:
        '1 semantic memory (mem_sem_001) with unified auth policy; episodic sources linked as provenance.',
    },
  },
};

export function getFixtureSnapshot(
  scenarioId: string,
  pointId: string
): EvolutionDemoSnapshot | undefined {
  return SNAPSHOTS[key(scenarioId, pointId)];
}
