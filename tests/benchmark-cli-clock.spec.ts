import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1794: benchmark-search-database 로 시드하는 scripts/ CLI 는 withBenchmarkClock 도 써야 한다 (#1396 부류).
 * 시계를 고정하지 않으면 시드와 검색이 벽시계에 따라 달라져 순위 기준선이 날마다 흔들린다.
 * LEGACY_UNCLOCKED 는 이 시험 이전에 이미 있던 CLI 다. 새 CLI 는 목록에 더하지 말고 withBenchmarkClock 으로 감싼다.
 */

const SEED_IMPORT = /\/benchmark-search-database(?:\.js)?['"]/;
const CLOCK_IMPORT = /\/benchmark-clock(?:\.js)?['"]/;
const CLOCK_WRAP = /\bwithBenchmarkClock\s*\(/;

const LEGACY_UNCLOCKED = new Set([
  'compare-weight-profiles.ts',
  'quality-benchmark-length-decay-sweep.ts',
  'quality-benchmark-maxsim.ts',
  'quality-benchmark-perf-smoke.ts',
  'ranking-preview.ts',
  'tune-weights.ts',
]);

const cliFiles = readdirSync(join(process.cwd(), 'scripts')).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts')
);
const seedingClis = cliFiles.filter((f) =>
  SEED_IMPORT.test(readFileSync(join(process.cwd(), 'scripts', f), 'utf-8'))
);

describe('벤치마크 CLI 시계 고정 (#1794)', () => {
  it('시드 CLI 를 찾는다', () => {
    expect(seedingClis.length).toBeGreaterThan(0);
  });

  it.each(seedingClis.filter((f) => !LEGACY_UNCLOCKED.has(f)))('%s 는 withBenchmarkClock 으로 시계를 고정한다', (f) => {
    const src = readFileSync(join(process.cwd(), 'scripts', f), 'utf-8');
    expect(
      CLOCK_IMPORT.test(src) && CLOCK_WRAP.test(src),
      `${f} 가 benchmark-search-database 로 시드하면서 scripts/lib/benchmark-clock 의 withBenchmarkClock 을 쓰지 않는다. 시드와 검색을 withBenchmarkClock 으로 감싼다.`
    ).toBe(true);
  });

  it('LEGACY_UNCLOCKED 에 시계를 쓰게 된 CLI 가 남지 않는다', () => {
    const stale = [...LEGACY_UNCLOCKED].filter(
      (f) => !seedingClis.includes(f) || CLOCK_WRAP.test(readFileSync(join(process.cwd(), 'scripts', f), 'utf-8'))
    );
    expect(stale, `목록에서 지운다: ${stale.join(', ')}`).toEqual([]);
  });
});
