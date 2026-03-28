import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  assertRankingProfileFilesExist,
  mean,
  pairedPermutationPValue,
  parseArgs,
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
});
