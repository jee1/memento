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
import { applyImportanceSignalScale } from './search-ranking-signals.js';
import { HybridResultRanker } from '../hybrid-result-ranker.js';
import { SearchResultCombiner } from '../search-result-combiner.js';
import type { IProceduralMemoryMatcher } from '../hybrid-search-types.js';
import type Database from 'better-sqlite3';

const STAMP = '2024-01-01T00:00:00.000Z';

describe('importance signal scale (#1082)', () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = join(tmpdir(), `ranking-weights-${randomUUID()}.toml`);
    resetRankingWeightsCache();
  });

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
    resetRankingWeightsCache();
  });

  function patchImportanceScale(base: string, scale: number): string {
    return base.replace(
      /(\[importance_signal\]\s*\nscale\s*=\s*)[\d.]+/,
      `$1${scale}`,
    );
  }

  function writeConfig(scale: number): void {
    const base = readFileSync(join(process.cwd(), 'config/ranking-weights.toml'), 'utf8');
    const patched = patchImportanceScale(base, scale);
    writeFileSync(tempConfigPath, patched, 'utf8');
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = tempConfigPath;
    resetRankingWeightsCache();
  }

  it('compresses raw importance toward 0.5 as scale drops', () => {
    expect(applyImportanceSignalScale(0.9, 1)).toBeCloseTo(0.9, 8);
    expect(applyImportanceSignalScale(0.9, 0)).toBeCloseTo(0.5, 8);
    expect(applyImportanceSignalScale(0.1, 0.5)).toBeCloseTo(0.3, 8);
    expect(applyImportanceSignalScale(0.1, 1)).toBeCloseTo(0.1, 8);
  });

  it('keeps higher importance above lower when relevance is equal', () => {
    writeConfig(0.35);
    const ranking = new SearchRanking();
    const low = ranking.calculateFinalScore({
      relevance: 0.4,
      recency: 0.5,
      importance: ranking.calculateImportance(0.2, false, 'semantic'),
      usage: 0.1,
      duplication_penalty: 0,
      feedback_score: 0.5,
    });
    const high = ranking.calculateFinalScore({
      relevance: 0.4,
      recency: 0.5,
      importance: ranking.calculateImportance(0.9, false, 'semantic'),
      usage: 0.1,
      duplication_penalty: 0,
      feedback_score: 0.5,
    });
    expect(high).toBeGreaterThan(low);
  });

  it('resolves absent and non-finite importance at the shared boundary', () => {
    writeConfig(0.35);
    const ranking = new SearchRanking(undefined, tempConfigPath);
    const baseline = ranking.calculateImportance(0.5, false, 'semantic');
    expect(ranking.calculateImportance(undefined, false, 'semantic')).toBeCloseTo(baseline, 8);
    expect(ranking.calculateImportance(null, false, 'semantic')).toBeCloseTo(baseline, 8);
    expect(ranking.calculateImportance(Number.NaN, false, 'semantic')).toBeCloseTo(baseline, 8);
    expect(ranking.calculateImportance(0, false, 'semantic')).toBeLessThan(baseline);
  });

  it('uses rankingWeightsPath for importance_signal.scale', () => {
    const lowScaleToml = join(tmpdir(), `ranking-weights-low-${randomUUID()}.toml`);
    const highScaleToml = join(tmpdir(), `ranking-weights-high-${randomUUID()}.toml`);
    const base = readFileSync(join(process.cwd(), 'config/ranking-weights.toml'), 'utf8');
    writeFileSync(lowScaleToml, patchImportanceScale(base, 0.1), 'utf8');
    writeFileSync(highScaleToml, patchImportanceScale(base, 0.9), 'utf8');
    const low = new SearchRanking(undefined, lowScaleToml);
    const high = new SearchRanking(undefined, highScaleToml);
    const lowScore = low.calculateImportance(0.9, false, 'semantic');
    const highScore = high.calculateImportance(0.9, false, 'semantic');
    expect(highScore).toBeGreaterThan(lowScore);
    if (existsSync(lowScaleToml)) unlinkSync(lowScaleToml);
    if (existsSync(highScaleToml)) unlinkSync(highScaleToml);
  });

  it('hybrid ranker uses SearchRanking scaled importance signal', async () => {
    writeConfig(0.35);
    const ranking = new SearchRanking(undefined, tempConfigPath);
    const expected = ranking.calculateImportance(0.8, true, 'semantic');

    const stubDb = {
      prepare: () => ({ all: () => [], get: () => undefined }),
    } as unknown as Database.Database;
    const matcher: IProceduralMemoryMatcher = {
      fetchProceduralMemoryMatches: () => new Map(),
    };
    const ranker = new HybridResultRanker(
      new SearchResultCombiner(),
      ranking,
      matcher,
      () => null,
    );
    const [item] = await ranker.combineAndSortResults(
      [{
        id: 'mem_a',
        content: 'content',
        type: 'semantic',
        importance: 0.8,
        created_at: STAMP,
        last_accessed: STAMP,
        pinned: true,
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

    const gamma = 0.2;
    expect(item?.score_breakdown?.importance.score).toBeCloseTo(gamma * expected, 8);
  });

  it('changes ranking version when importance_signal.scale changes', () => {
    writeConfig(1);
    const atOne = getRankingVersion(tempConfigPath);
    writeConfig(0.35);
    const calibrated = getRankingVersion(tempConfigPath);
    expect(calibrated).not.toBe(atOne);
    expect(calibrated).toMatch(/^ranking-sha256:[a-f0-9]{12}$/);
  });
});
