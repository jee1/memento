import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { loadRankingWeights } from '@memento/core/shared/config/ranking-weights-loader.js';
import {
  TIE_RATE_TOLERANCE,
  generateCandidate,
  parseKnobs,
  parseTuneArgs,
  relevanceTieRate,
  splitQueries,
  tieGateRejectReason,
  type CategoryMapping,
} from './tune-weights.js';
import { TUNABLE_KNOBS, type KnobKey } from '@memento/core/shared/config/ranking-knobs.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapping = JSON.parse(
  readFileSync(join(ROOT, 'tests/fixtures/search-quality/benchmark-v3/category-mapping.json'), 'utf8'),
) as CategoryMapping;
const ids = Object.keys(mapping.query_id_to_category);
const baseline = loadRankingWeights(join(ROOT, 'config/ranking-profiles/default.toml'));
const keys = Object.keys(TUNABLE_KNOBS) as KnobKey[];

function macroOf(id: string): string {
  const label = mapping.query_id_to_category[id]!;
  return Object.entries(mapping.macro_categories).find(([, cats]) => cats.includes(label))![0];
}

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
}

describe('splitQueries', () => {
  it('같은 시드면 같은 분할', () => {
    expect(splitQueries(ids, mapping, 7)).toEqual(splitQueries(ids, mapping, 7));
    expect(splitQueries(ids, mapping, 7).explore_query_ids).not.toEqual(
      splitQueries(ids, mapping, 8).explore_query_ids,
    );
  });

  it('서로소이며 모든 id 를 덮는다', () => {
    const { explore_query_ids: e, judge_query_ids: j } = splitQueries(ids, mapping, 3);
    expect(new Set([...e, ...j]).size).toBe(ids.length);
    expect(e.filter((id) => j.includes(id))).toEqual([]);
  });

  it('모든 macro 층이 explore 에 들어가고 explore 가 ceil(n/2) 를 받는다', () => {
    for (const seed of [1, 2, 3]) {
      const { strata } = splitQueries(ids, mapping, seed);
      const sizes = new Map<string, number>();
      for (const id of ids) sizes.set(macroOf(id), (sizes.get(macroOf(id)) ?? 0) + 1);
      for (const [macro, n] of sizes) {
        expect(strata[macro]!.explore.length).toBe(Math.ceil(n / 2));
        expect(strata[macro]!.explore.length + strata[macro]!.judge.length).toBe(n);
      }
    }
  });

  it('매핑 없는 query 는 unmapped 층에 둔다', () => {
    const { strata } = splitQueries(['q_001', 'q_zzz'], mapping, 1);
    expect(strata.unmapped!.explore).toEqual(['q_zzz']);
  });
});

describe('knobs', () => {
  it('--knobs 파싱', () => {
    expect(parseKnobs('relevance_signal.scale, recency_signal.scale')).toEqual([
      'relevance_signal.scale',
      'recency_signal.scale',
    ]);
    expect(parseTuneArgs([]).knobs).toEqual(keys);
    expect(parseTuneArgs(['--knobs', 'fts_relevance.temperature']).knobs).toEqual(['fts_relevance.temperature']);
    expect(() => parseKnobs('relevance_signal.scale,nope')).toThrow(/nope/);
    expect(() => parseTuneArgs(['--knobs', 'bogus'])).toThrow();
  });

  it('후보가 경계 안에 있고 saturation >= characteristic', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { config, knobs } = generateCandidate(baseline, rng(seed));
      for (const k of keys) {
        expect(knobs[k]).toBeGreaterThanOrEqual(TUNABLE_KNOBS[k].min);
        expect(knobs[k]).toBeLessThanOrEqual(TUNABLE_KNOBS[k].max);
      }
      expect(config.vector_length_decay.saturation_length).toBeGreaterThanOrEqual(
        config.vector_length_decay.characteristic_length,
      );
    }
  });

  it('선택하지 않은 knob 은 baseline 값을 유지하고 전체 설정을 돌려준다', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { config, knobs } = generateCandidate(baseline, rng(seed), ['relevance_signal.scale']);
      expect(config).toEqual({ ...baseline, relevance_signal: config.relevance_signal });
      expect(knobs['ranking_weights.alpha']).toBe(baseline.ranking_weights.alpha);
      expect(knobs['relevance_signal.scale']).toBe(config.relevance_signal.scale);
    }
  });

  it('decay 한쪽만 움직여도 선택하지 않은 쪽은 그대로다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const sat = generateCandidate(baseline, rng(seed), ['vector_length_decay.saturation_length']);
      expect(sat.config.vector_length_decay.characteristic_length).toBe(
        baseline.vector_length_decay.characteristic_length,
      );
      const ch = generateCandidate(baseline, rng(seed), ['vector_length_decay.characteristic_length']);
      expect(ch.config.vector_length_decay.saturation_length).toBe(baseline.vector_length_decay.saturation_length);
    }
  });
});

describe('relevance tie gate', () => {
  it('baseline + 0.004 는 통과, + 0.006 은 tie 사유로 거절', () => {
    expect(tieGateRejectReason(0.004, 0)).toBeUndefined();
    expect(tieGateRejectReason(0.0031, 0.0008)).toBeUndefined();
    expect(tieGateRejectReason(0.006, 0)).toMatch(/tie/);
    expect(TIE_RATE_TOLERANCE).toBe(0.005);
  });

  it('동점 비율은 전체 쌍 대비 합산', () => {
    expect(relevanceTieRate({ relevance_tie_pairs: [1, 0], pairs: [45, 45] })).toBeCloseTo(1 / 90, 10);
    expect(relevanceTieRate({ relevance_tie_pairs: [], pairs: [] })).toBe(0);
  });
});
