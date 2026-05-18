import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  assertRankingProfileFilesExist,
  mean,
  pairedPermutationPValue,
  parseArgs,
  calcP95,
  evaluateProfile,
} from './compare-weight-profiles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('compare-weight-profiles (T026)', () => {
  it('parseArgs 기본값과 플래그 파싱', () => {
    expect(parseArgs([])).toEqual({ profileA: 'default', profileB: 'feedback-heavy' });
    expect(parseArgs(['--profile-a', 'foo', '--profile-b', 'bar'])).toEqual({
      profileA: 'foo',
      profileB: 'bar',
    });
  });

  it('mean', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('pairedPermutationPValue는 동일 분포면 p≈1', () => {
    const rr = [0.5, 0.25, 1];
    const p = pairedPermutationPValue(rr, rr, 500);
    expect(p).toBe(1);
  });

  it('pairedPermutationPValue 결과는 0~1', () => {
    const p = pairedPermutationPValue([1, 0, 0], [0, 1, 0], 200);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('assertRankingProfileFilesExist는 존재하지 않는 프로파일 경로에서 즉시 실패', () => {
    const existing = join(ROOT, 'config/ranking-profiles/default.toml');
    const missing = join(ROOT, 'config/ranking-profiles/__no_such_profile__.toml');
    expect(() => assertRankingProfileFilesExist(existing, missing)).toThrow(/찾을 수 없습니다/);
  });

  it('pairedPermutationPValue — seeded rng 주입 시 재현성', () => {
    const seed = 42;
    const makeRng = () => {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 4294967296;
      };
    };
    const rrA = [1, 0.5, 0];
    const rrB = [0, 1, 0.5];
    const p1 = pairedPermutationPValue(rrA, rrB, 1000, makeRng());
    const p2 = pairedPermutationPValue(rrA, rrB, 1000, makeRng());
    expect(p1).toBe(p2);
  });

  it('evaluateProfile이 export된 async function', () => {
    expect(typeof evaluateProfile).toBe('function');
  });
});

describe('calcP95', () => {
  it('빈 배열은 0 반환', () => {
    expect(calcP95([])).toBe(0);
  });

  it('단일 값은 그 값 반환', () => {
    expect(calcP95([42])).toBe(42);
  });

  it('정렬 순서 무관하게 p95 계산', () => {
    // nearest-rank: ceil(10 * 0.95) - 1 = 9 → sorted[9]
    const vals = [10, 30, 20, 90, 40, 50, 60, 70, 80, 100];
    expect(calcP95(vals)).toBe(100);
  });

  it('p95는 상위 5%를 제외한 최댓값', () => {
    // 20개 값: ceil(20 * 0.95) - 1 = 19 → sorted[18] = 95
    const vals = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
    expect(calcP95(vals)).toBe(95);
  });
});
