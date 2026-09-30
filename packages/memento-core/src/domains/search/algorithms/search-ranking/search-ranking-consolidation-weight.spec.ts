import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  getRankingWeights,
  resetRankingWeightsCache,
} from '../../../../shared/config/ranking-weights-loader.js';
import { resolveSearchRankingWeights } from './search-ranking-composite.js';
import { SearchRanking } from '../search-ranking.js';

describe('consolidation blend weight (#1184)', () => {
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

  function writeTempToml(body: string): string {
    const path = join(tmpdir(), `ranking-weights-consolidation-${randomUUID()}.toml`);
    writeFileSync(path, body, 'utf8');
    tempPaths.push(path);
    return path;
  }

  function useToml(body: string): string {
    const path = writeTempToml(body);
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = path;
    resetRankingWeightsCache();
    return path;
  }

  function tomlWithConsolidation(consolidation: number): string {
    const base = readFileSync(join(process.cwd(), 'config/ranking-weights.toml'), 'utf8');
    const patched = base.replace(
      /consolidation\s*=\s*[\d.]+/,
      `consolidation = ${consolidation}`,
    );
    if (patched === base) {
      throw new Error('consolidation key not found in config/ranking-weights.toml');
    }
    return patched;
  }

  it('defaults consolidation weight to 0 when the TOML omits it', () => {
    const toml = `[ranking_weights]
alpha = 0.45
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 5
`;
    useToml(toml);
    expect(getRankingWeights().ranking_weights.consolidation).toBe(0);
    expect(resolveSearchRankingWeights().consolidation_score).toBe(0);
  });

  it('reads consolidation weight from the loaded config', () => {
    useToml(tomlWithConsolidation(0.3));
    expect(resolveSearchRankingWeights().consolidation_score).toBe(0.3);

    const features = {
      relevance: 0.8,
      recency: 0.6,
      importance: 0.7,
      usage: 0.5,
      duplication_penalty: 0.2,
      consolidation_score: 0.9,
    };
    const w = 0.3;
    const relevanceScore = (1 - w) * features.relevance + w * features.consolidation_score;
    const expected =
      0.45 * relevanceScore +
      0.2 * features.recency +
      0.2 * features.importance +
      0.1 * features.usage -
      0.1 * features.duplication_penalty;

    const ranking = new SearchRanking({ zeta_fb: 0 });
    expect(ranking.calculateFinalScore(features)).toBeCloseTo(expected, 10);
  });

  it('repeat recall cannot move the score at the default weight (#1184)', () => {
    const ranking = new SearchRanking({ zeta_fb: 0 });
    const baseFeatures = {
      relevance: 0.62,
      recency: 0.5,
      importance: 0.5,
      usage: 0.5,
      duplication_penalty: 0,
    };
    const withoutRecall = ranking.calculateFinalScore({
      ...baseFeatures,
      consolidation_score: 0,
    });
    const afterRecall = ranking.calculateFinalScore({
      ...baseFeatures,
      consolidation_score: 0.6225,
    });
    expect(withoutRecall).toBe(afterRecall);
  });

  it('consolidation weight flips ranking when enabled (#1184)', () => {
    const candidateA = {
      relevance: 0.62,
      recency: 0.5,
      importance: 0.5,
      usage: 0.5,
      duplication_penalty: 0,
      consolidation_score: 0,
    };
    const candidateB = {
      relevance: 0.6,
      recency: 0.5,
      importance: 0.5,
      usage: 0.5,
      duplication_penalty: 0,
      consolidation_score: 0.6225,
    };

    const defaultRanking = new SearchRanking({ zeta_fb: 0 });
    expect(defaultRanking.calculateFinalScore(candidateA)).toBeGreaterThan(
      defaultRanking.calculateFinalScore(candidateB),
    );

    useToml(tomlWithConsolidation(0.2));
    const enabledRanking = new SearchRanking({ zeta_fb: 0 });
    expect(enabledRanking.calculateFinalScore(candidateB)).toBeGreaterThan(
      enabledRanking.calculateFinalScore(candidateA),
    );
  });
});
