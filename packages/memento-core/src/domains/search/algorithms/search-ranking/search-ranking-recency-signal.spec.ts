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
import { applyRecencySignalScale } from './search-ranking-signals.js';
import { HybridResultRanker } from '../hybrid-result-ranker.js';
import { SearchResultCombiner } from '../search-result-combiner.js';
import type { IProceduralMemoryMatcher } from '../hybrid-search-types.js';
import type Database from 'better-sqlite3';

const OLD_STAMP = '2024-01-01T00:00:00.000Z';
const BETA = 0.2;

describe('recency signal scale (#1175)', () => {
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

  /** Writes config/ranking-weights.toml with [recency_signal].scale replaced. */
  function tomlWithScale(scale: number): string {
    const base = readFileSync(join(process.cwd(), 'config/ranking-weights.toml'), 'utf8');
    const patched = base.replace(/(\[recency_signal\]\s*\nscale\s*=\s*)[\d.]+/, `$1${scale}`);
    if (patched === base) {
      throw new Error('[recency_signal].scale not found in config/ranking-weights.toml');
    }
    const path = join(tmpdir(), `ranking-weights-recency-${randomUUID()}.toml`);
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

  it('compresses raw recency toward 0.5 as scale drops', () => {
    expect(applyRecencySignalScale(0.9, 1)).toBeCloseTo(0.9, 8);
    expect(applyRecencySignalScale(0.9, 0)).toBeCloseTo(0.5, 8);
    expect(applyRecencySignalScale(0.1, 0.5)).toBeCloseTo(0.3, 8);
    expect(applyRecencySignalScale(0.1, 1)).toBeCloseTo(0.1, 8);
    expect(applyRecencySignalScale(1.4, 1)).toBeCloseTo(1, 8);
    expect(applyRecencySignalScale(-0.4, 1)).toBeCloseTo(0, 8);
  });

  it('keeps newer above older at the shipped scale', () => {
    const ranking = new SearchRanking(undefined, tomlWithScale(0.3));
    const newer = ranking.calculateRecency(new Date(Date.now() - 86_400_000), 'episodic');
    const older = ranking.calculateRecency(new Date(Date.now() - 200 * 86_400_000), 'episodic');
    expect(newer).toBeGreaterThan(older);
  });

  it('text lane reads recency_signal.scale from the TOML it was given', () => {
    const flat = new SearchRanking(undefined, tomlWithScale(0));
    const raw = new SearchRanking(undefined, tomlWithScale(1));
    // scale=0 flattens every age to exactly 0.5; scale=1 keeps the bare half-life curve.
    expect(flat.calculateRecency(new Date(OLD_STAMP), 'episodic')).toBeCloseTo(0.5, 8);
    expect(flat.calculateRecency(new Date(), 'episodic')).toBeCloseTo(0.5, 8);
    expect(raw.calculateRecency(new Date(OLD_STAMP), 'episodic')).toBeLessThan(0.001);
    expect(raw.calculateRecency(new Date(), 'episodic')).toBeCloseTo(1, 6);
  });

  async function recencyTerm(createdAt: string): Promise<number> {
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
        created_at: createdAt,
        last_accessed: createdAt,
        pinned: false,
        tags: [],
        score: 0.5,
      }],
      [],
      { textWeight: 0.7, vectorWeight: 0.3 },
      10,
      stubDb,
      false,
      { query: 'q', include_score_breakdown: true },
    );
    return item?.score_breakdown?.recency.score ?? Number.NaN;
  }

  it('fusion lane reads recency_signal.scale from the loaded config', async () => {
    useGlobalConfig(0);
    // scale=0 → every candidate gets the neutral 0.5, regardless of age.
    expect(await recencyTerm(OLD_STAMP)).toBeCloseTo(BETA * 0.5, 8);
    expect(await recencyTerm(new Date().toISOString())).toBeCloseTo(BETA * 0.5, 8);

    useGlobalConfig(1);
    // scale=1 → bare exp curve: a brand-new item keeps ~1, a 2024 item is ~0.
    expect(await recencyTerm(new Date().toISOString())).toBeCloseTo(BETA, 4);
    expect(await recencyTerm(OLD_STAMP)).toBeLessThan(BETA * 0.001);
  });

  it('changes ranking version when recency_signal.scale changes', () => {
    const atOne = getRankingVersion(tomlWithScale(1));
    const calibrated = getRankingVersion(tomlWithScale(0.3));
    expect(calibrated).not.toBe(atOne);
    expect(calibrated).toMatch(/^ranking-sha256:[a-f0-9]{12}$/);
  });
});
