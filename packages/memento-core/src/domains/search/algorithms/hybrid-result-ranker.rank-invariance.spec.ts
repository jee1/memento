import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRankingWeightsCache } from '../../../shared/config/ranking-weights-loader.js';
import type { RepositoryProvider } from '../../../shared/ports/repository-provider.port.js';
import type { VectorSearchResult } from '../../embedding/services/memory-embedding-service.js';
import { HybridResultRanker } from './hybrid-result-ranker.js';
import type {
  HybridSearchQuery,
  IProceduralMemoryMatcher,
  ProceduralMemoryMatch,
} from './hybrid-search-types.js';
import { SearchRanking } from './search-ranking.js';
import { SearchResultCombiner } from './search-result-combiner.js';

const NOW = Date.parse('2026-11-14T00:00:00.000Z');
const WEIGHTS = { textWeight: 0.6, vectorWeight: 0.4 };
const CANDIDATE_COUNT = 24;

const TOML = `
[ranking_weights]
alpha = 0.45
beta = 0.20
gamma = 0.20
theta = 0.10
zeta_fb = 0.05

[importance_signal]
scale = 0.35

[recency_signal]
scale = 0.30

[relevance_signal]
scale = 2.0
`;

const ids = Array.from({ length: CANDIDATE_COUNT }, (_, i) => `cand-${String(i).padStart(2, '0')}`);

function typeOf(i: number): string {
  if (i % 6 === 0) return 'procedural';
  return i % 3 === 0 ? 'episodic' : 'semantic';
}

function createdAt(i: number): string {
  return new Date(NOW - ((i * 13) % 200) * 86_400_000).toISOString();
}

function base(i: number) {
  return {
    id: ids[i]!,
    content: `${ids[i]} content`,
    type: typeOf(i),
    importance: 0.3 + ((i * 5) % 10) / 20,
    created_at: createdAt(i),
    last_accessed: createdAt(i),
    pinned: i % 8 === 0,
    tags: i % 2 === 0 ? ['topic-a'] : ['other'],
  };
}

function textHit(i: number) {
  return { ...base(i), score: 0.05 + (((i * 7) % CANDIDATE_COUNT) / CANDIDATE_COUNT) * 0.9 };
}

function vectorHit(i: number): VectorSearchResult {
  const similarity = 0.05 + (((i * 11) % CANDIDATE_COUNT) / CANDIDATE_COUNT) * 0.9;
  return { ...base(i), similarity, score: similarity };
}

const feedbackNet = new Map<string, number>(
  ids.flatMap((id, i): Array<[string, number]> => {
    if (i % 4 === 1) return [[id, 3]];
    if (i % 5 === 2) return [[id, -2]];
    return [];
  }),
);

const repositories = {
  feedback: () => ({ getNetScores: () => feedbackNet }),
  processAttribute: () => ({
    getByProcessId: () => ({ process_id: 'proc-1', topics: ['topic-a'] }),
  }),
} as unknown as RepositoryProvider;

const db = {
  prepare: () => ({
    all: () =>
      ids.map((id, i) => ({
        id,
        tags: JSON.stringify(i % 2 === 0 ? ['topic-a'] : ['other']),
        workflow_name: null,
        skill_name: null,
      })),
    get: () => undefined,
  }),
} as unknown as Database.Database;

const matcher: IProceduralMemoryMatcher = {
  fetchProceduralMemoryMatches: (_db, proceduralIds) =>
    new Map<string, ProceduralMemoryMatch>(
      proceduralIds.map((id, n) => [
        id,
        {
          workflow_name_match: n % 2 === 0,
          skill_name_match: n % 3 === 0,
          trigger_conditions_match: n === 1,
        },
      ]),
    ),
};

const query: HybridSearchQuery = {
  query: 'rank invariance',
  include_score_breakdown: true,
  filters: { process_id: 'proc-1' },
};

// Order and scores pinned on the code before #1694 removed delta (usage) and epsilon (duplication_penalty).
// Every candidate carried the same constant usage term, so scores only shift by delta * min(1, ln2 / 10).
const REMOVED_USAGE_TERM = (0.1 * Math.LN2) / 10;
const EXPECTED_ORDER = [
  'cand-06',
  'cand-10',
  'cand-17',
  'cand-02',
  'cand-13',
  'cand-16',
  'cand-12',
  'cand-03',
  'cand-20',
  'cand-00',
  'cand-23',
  'cand-19',
  'cand-08',
  'cand-15',
  'cand-04',
  'cand-18',
  'cand-09',
  'cand-01',
  'cand-05',
  'cand-22',
  'cand-21',
  'cand-14',
  'cand-11',
  'cand-07',
];
const PINNED_SCORES = [
  0.8538277811363963,
  0.7229078487780398,
  0.6969945105470687,
  0.6842963672975443,
  0.6612689628108833,
  0.5858057455741669,
  0.5740239002128855,
  0.5715490436962866,
  0.5639314718055995,
  0.5404314718055995,
  0.5332733647782714,
  0.5204367209981224,
  0.48735873144600084,
  0.4668443844129619,
  0.4589768473468313,
  0.416283146462346,
  0.37132932863123225,
  0.36474310471531807,
  0.3606736589188262,
  0.30861780525441507,
  0.2974184097888704,
  0.27082663580926547,
  0.18963562412988122,
  0.17572031766996216,
];
const EXPECTED_SCORES = PINNED_SCORES.map((score) => score - REMOVED_USAGE_TERM);

describe('HybridResultRanker rank invariance (#1694)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rank-invariance-'));
    const path = join(dir, 'ranking-weights.toml');
    writeFileSync(path, TOML);
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = path;
  });

  afterAll(() => {
    delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    resetRankingWeightsCache();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetRankingWeightsCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the candidate order and the exact scores', async () => {
    const ranker = new HybridResultRanker(
      new SearchResultCombiner(),
      new SearchRanking(),
      matcher,
      () => null,
      repositories,
    );
    const items = await ranker.combineAndSortResults(
      ids.map((_, i) => textHit(i)),
      ids.map((_, i) => vectorHit(i)),
      WEIGHTS,
      CANDIDATE_COUNT,
      db,
      false,
      query,
    );

    expect(items.map((item) => item.id)).toEqual(EXPECTED_ORDER);
    items.forEach((item, rank) => {
      expect(item.finalScore).toBeCloseTo(EXPECTED_SCORES[rank]!, 12);
    });
  });
});
