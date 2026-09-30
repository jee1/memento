import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  getRankingVersion,
  resetRankingWeightsCache,
} from '../../../../shared/config/ranking-weights-loader.js';
import { SearchRanking } from '../search-ranking.js';
import { applyRelevanceSignalScale } from './search-ranking-signals.js';
import { HybridResultRanker } from '../hybrid-result-ranker.js';
import { SearchResultCombiner } from '../search-result-combiner.js';
import type { IProceduralMemoryMatcher } from '../hybrid-search-types.js';
import type Database from 'better-sqlite3';

const ALPHA = 0.45;
const FUSION_A = 0.661;
const FUSION_B = 0.525;

describe('relevance signal scale (#1180)', () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetRankingWeightsCache();
  });

  afterEach(() => {
    for (const p of tempPaths.splice(0)) {
      if (existsSync(p)) {
        unlinkSync(p);
      }
    }
    delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    resetRankingWeightsCache();
  });

  /** Writes config/ranking-weights.toml with [relevance_signal].scale replaced. */
  function tomlWithScale(scale: number): string {
    const base = readFileSync(join(process.cwd(), 'config/ranking-weights.toml'), 'utf8');
    const patched = base.replace(/(\[relevance_signal\]\s*\nscale\s*=\s*)[\d.]+/, `$1${scale}`);
    if (patched === base) {
      throw new Error('[relevance_signal].scale not found in config/ranking-weights.toml');
    }
    const path = join(tmpdir(), `ranking-weights-relevance-${randomUUID()}.toml`);
    writeFileSync(path, patched, 'utf8');
    tempPaths.push(path);
    return path;
  }

  function useGlobalConfig(scale: number): string {
    const path = tomlWithScale(scale);
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = path;
    resetRankingWeightsCache();
    return path;
  }

  it('rescales raw fusion relevance around 0.5 as scale changes', () => {
    expect(applyRelevanceSignalScale(0.7, 1)).toBeCloseTo(0.7, 8);
    expect(applyRelevanceSignalScale(0.7, 0)).toBeCloseTo(0.5, 8);
    expect(applyRelevanceSignalScale(0.7, 2)).toBeCloseTo(0.9, 8);
    expect(applyRelevanceSignalScale(0.3, 2)).toBeCloseTo(0.1, 8);
    expect(applyRelevanceSignalScale(0.9, 5)).toBeCloseTo(1, 8);
    expect(applyRelevanceSignalScale(0.1, 5)).toBeCloseTo(0, 8);
    expect(applyRelevanceSignalScale(0.7, 99)).toBeCloseTo(applyRelevanceSignalScale(0.7, 5), 8);
    expect(applyRelevanceSignalScale(1.4, 1)).toBeCloseTo(1, 8);
    expect(applyRelevanceSignalScale(-0.4, 1)).toBeCloseTo(0, 8);
  });

  async function relevanceTerm(textScore: number, vectorScore = 0): Promise<number> {
    const stubDb = {
      prepare: () => ({ all: () => [], get: () => undefined }),
    } as unknown as Database.Database;
    const matcher: IProceduralMemoryMatcher = {
      fetchProceduralMemoryMatches: () => new Map(),
    };
    const ranker = new HybridResultRanker(
      new SearchResultCombiner(),
      new SearchRanking(),
      matcher,
      () => null,
    );
    const [item] = await ranker.combineAndSortResults(
      [{
        id: 'mem_a',
        content: 'content',
        type: 'semantic',
        importance: 0.5,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        pinned: false,
        tags: [],
        score: textScore,
      }],
      vectorScore > 0
        ? [{
          id: 'mem_a',
          content: 'content',
          similarity: vectorScore,
        }]
        : [],
      { textWeight: 1, vectorWeight: 0 },
      10,
      stubDb,
      false,
      { query: 'q', include_score_breakdown: true },
    );
    return item?.score_breakdown?.relevance.score ?? Number.NaN;
  }

  it('fusion lane reads relevance_signal.scale from the loaded config', async () => {
    const rawFusion = 0.7;

    useGlobalConfig(0);
    expect(await relevanceTerm(rawFusion)).toBeCloseTo(ALPHA * 0.5, 8);

    useGlobalConfig(1);
    expect(await relevanceTerm(rawFusion)).toBeCloseTo(ALPHA * rawFusion, 8);

    useGlobalConfig(3);
    const scaled = applyRelevanceSignalScale(rawFusion, 3);
    expect(await relevanceTerm(rawFusion)).toBeCloseTo(ALPHA * scaled, 8);
  });

  it('widens the relevance slot spread when scale increases', async () => {
    const highFusion = 0.7;
    const lowFusion = 0.3;

    async function spreadAt(scale: number): Promise<number> {
      useGlobalConfig(scale);
      const high = await relevanceTerm(highFusion);
      const low = await relevanceTerm(lowFusion);
      return high - low;
    }

    const atOne = await spreadAt(1);
    const atTwo = await spreadAt(2);
    expect(atTwo).toBeCloseTo(atOne * 2, 6);
  });

  function daysAgo(n: number): string {
    return new Date(Date.now() - n * 86_400_000).toISOString();
  }

  async function topIdAtScale(scale: number): Promise<string> {
    useGlobalConfig(scale);
    const stubDb = {
      prepare: () => ({ all: () => [], get: () => undefined }),
    } as unknown as Database.Database;
    const matcher: IProceduralMemoryMatcher = {
      fetchProceduralMemoryMatches: () => new Map(),
    };
    const ranker = new HybridResultRanker(
      new SearchResultCombiner(),
      new SearchRanking(),
      matcher,
      () => null,
    );
    const stamp = daysAgo(12);
    const results = await ranker.combineAndSortResults(
      [
        {
          id: 'mem_a',
          content: 'correct',
          type: 'semantic',
          importance: 0.3,
          created_at: daysAgo(170),
          last_accessed: stamp,
          pinned: false,
          tags: [],
          score: FUSION_A,
        },
        {
          id: 'mem_b',
          content: 'distractor',
          type: 'semantic',
          importance: 0.85,
          created_at: stamp,
          last_accessed: stamp,
          pinned: false,
          tags: [],
          score: FUSION_B,
        },
      ],
      [],
      { textWeight: 1, vectorWeight: 0 },
      10,
      stubDb,
      false,
      { query: 'q', include_score_breakdown: true },
    );
    return results[0]?.id ?? '';
  }

  it('flips ranking when scale expands fusion relevance (#1180 F3/F4)', async () => {
    expect(await topIdAtScale(1)).toBe('mem_b');
    expect(await topIdAtScale(2)).toBe('mem_a');
  });

  it('changes ranking version when relevance_signal.scale changes', () => {
    const atOne = getRankingVersion(tomlWithScale(1));
    const expanded = getRankingVersion(tomlWithScale(2));
    expect(expanded).not.toBe(atOne);
    expect(expanded).toMatch(/^ranking-sha256:[a-f0-9]{12}$/);
  });
});
