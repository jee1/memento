import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveQualityCommand } from './quality.js';
import { runRejectionSweep } from './quality-benchmark-rejection-sweep.js';
import {
  isGateScoreCacheCurrent,
  parseGateScoreCache,
  parseLabelPack,
  rejectionSweepThresholds,
  sweepRejectionThresholds,
  wilson95,
} from './lib/rejection-sweep.js';

const FIXTURE = new URL('../tests/fixtures/search-quality/rejection-sweep/gate-scores.json', import.meta.url);
const loadFixture = () => parseGateScoreCache(JSON.parse(readFileSync(FIXTURE, 'utf8')));

describe('rejection-sweep (#1400)', () => {
  it('registers benchmark:rejection-sweep', () => {
    expect(resolveQualityCommand(['benchmark', 'rejection-sweep']).script).toBe(
      'quality-benchmark-rejection-sweep.ts'
    );
  });

  it('threshold grid is exact', () => {
    expect(rejectionSweepThresholds()).toEqual([0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]);
  });

  it('wilson95 handles n=0 and a known value', () => {
    expect(wilson95(0, 0)).toEqual([0, 1]);
    const [lo, hi] = wilson95(5, 10);
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
  });

  it('curve counts follow top_score < threshold; boundary and null are not rejected', () => {
    const { counts, curve } = sweepRejectionThresholds(loadFixture().rows);
    expect(counts).toEqual({ relevant: 4, unrelated: 4, unscored: { relevant: 1, unrelated: 0 } });
    const at = (t: number) => curve.find((p) => p.threshold === t)!;
    // unrelated 0.4 가 t=0.4 에서 기각되지 않는다(경계), t=0.45 에서 기각된다
    expect(at(0.4).unrelated_rejection.rejected).toBe(2);
    expect(at(0.45).unrelated_rejection.rejected).toBe(3);
    // relevant: 0.3 은 t=0.35 부터, 0.45 는 t=0.5 부터 기각. null 은 끝까지 기각 안 됨
    expect(at(0.3).relevant_false_rejection.rejected).toBe(0);
    expect(at(0.35).relevant_false_rejection.rejected).toBe(1);
    expect(at(0.6).relevant_false_rejection.rejected).toBe(2);
    expect(at(0.6).relevant_false_rejection).toMatchObject({ n: 4, rate: 0.5 });
  });

  it('label pack maps labels, excludes unclear, throws on unknown label', () => {
    const { rows, excluded } = parseLabelPack([
      { search_id: 'a', top_score: 0.1, label: 'false_reject' },
      { search_id: 'b', top_score: 0.2, label: 'true_reject' },
      { search_id: 'c', top_score: 0.3, label: 'unclear' },
    ]);
    expect(rows).toEqual([
      { group: 'relevant', top_score: 0.1 },
      { group: 'unrelated', top_score: 0.2 },
    ]);
    expect(excluded).toBe(1);
    expect(() => parseLabelPack([{ search_id: 'x', top_score: 0.1, label: 'maybe' }])).toThrow(/label/);
  });

  it('label-pack report carries aggregates only (no search_id)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweep-'));
    const path = join(dir, 'labels.json');
    writeFileSync(
      path,
      JSON.stringify([
        { search_id: 'secret-id-1', top_score: 0.1, label: 'false_reject' },
        { search_id: 'secret-id-2', top_score: 0.45, label: 'true_reject' },
        { search_id: 'secret-id-3', top_score: 0.3, label: 'unclear' },
      ])
    );
    const report = await runRejectionSweep({ labelsPath: path });
    expect(JSON.stringify(report)).not.toMatch(/secret-id|search_id/);
    expect(report.source).toEqual({ kind: 'label-pack' });
    expect(report.counts).toEqual({ relevant: 1, unrelated: 1, excluded: 1, unscored: { relevant: 0, unrelated: 0 } });
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it('detects stale cache by benchmark version, model, and doc_chars', () => {
    const cache = loadFixture();
    const key = { benchmark_version: cache.benchmark_version, gate: cache.gate };
    expect(isGateScoreCacheCurrent(cache, key)).toBe(true);
    expect(isGateScoreCacheCurrent(cache, { ...key, benchmark_version: 'v2' })).toBe(false);
    expect(isGateScoreCacheCurrent(cache, { ...key, gate: { ...key.gate, model: 'other' } })).toBe(false);
    expect(isGateScoreCacheCurrent(cache, { ...key, gate: { ...key.gate, doc_chars: 1 } })).toBe(false);
  });
});
