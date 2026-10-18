import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_MACROS,
  type CategoryMeasurement,
  type CategoryQualityReport,
  type MacroCategory,
  type ResolvedRankingScope,
} from '../../packages/memento-core/src/shared/types/benchmark.types.js';
import {
  evaluatePerf,
  evaluateRanking,
  MRR_DROP_EPSILON,
  PERF_CORPUS_ROWS,
  PERF_P95_SLACK,
  PERF_RSS_SLACK,
  planRankingRun,
  PR_CORPUS_CAP,
} from './quality-baseline.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quality-baseline-'));
  dirs.push(dir);
  return dir;
}

function report(macro: MacroCategory, mrr: number): CategoryQualityReport {
  return {
    macro_category: macro,
    query_count: 1,
    authored_query_count: 1,
    mrr,
    ndcg_at_5: 0.5,
    ndcg_at_10: 0.4,
    mean_top10_content_length: 100,
    mean_top10_long_doc_ratio: 0,
    threshold_passed: mrr >= 0.5,
  };
}

function measurementFrom(mrrByMacro: Record<MacroCategory, number>): CategoryMeasurement {
  const scored_query_ids_by_macro = {
    incident_ops: ['q-incident_ops'],
    procedural: ['q-procedural'],
    conceptual: ['q-conceptual'],
    tag_filter: ['q-tag_filter'],
  } as const;
  return {
    reports: ALL_MACROS.map((macro) => report(macro, mrrByMacro[macro])),
    scored_query_ids_by_macro,
  };
}

function measurementWithLowerMacro(
  measurement: CategoryMeasurement,
  macro: MacroCategory,
  drop: number,
): CategoryMeasurement {
  return {
    ...measurement,
    reports: measurement.reports.map((row) =>
      row.macro_category === macro ? { ...row, mrr: row.mrr - drop } : row,
    ),
  };
}

function prScope(measurement: CategoryMeasurement): ResolvedRankingScope {
  const queryIds = ALL_MACROS.flatMap((macro) => measurement.scored_query_ids_by_macro[macro]).sort();
  return {
    name: 'pr',
    corpusBenchmarkIds: ['doc-a', 'doc-b'],
    queryIds,
  };
}

const baseMrr = {
  incident_ops: 0.8,
  procedural: 0.8,
  conceptual: 0.8,
  tag_filter: 0.8,
} as const;

function writeHigherBaseline(dir: string): { path: string; measurement: CategoryMeasurement; scope: ResolvedRankingScope } {
  const measurement = measurementFrom(baseMrr);
  const scope = prScope(measurement);
  const path = join(dir, 'ranking.json');
  const written = evaluateRanking({
    measurement,
    scope,
    seededBenchmarkIds: scope.corpusBenchmarkIds,
    embeddingProvider: 'minilm',
    baselinePath: path,
    elapsedMs: 10,
    writeBaseline: true,
  });
  expect(written.mode).toBe('write');
  return { path, measurement, scope };
}

describe('evaluateRanking', () => {
  it('fails mrr_drop when one macro drops by 0.031', () => {
    const { path, measurement, scope } = writeHigherBaseline(tempDir());
    const outcome = evaluateRanking({
      measurement: measurementWithLowerMacro(measurement, 'procedural', 0.031),
      scope,
      seededBenchmarkIds: scope.corpusBenchmarkIds,
      embeddingProvider: 'minilm',
      baselinePath: path,
      elapsedMs: 10,
      writeBaseline: false,
    });
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes).toEqual([
      { kind: 'ranking', reason: 'mrr_drop', macros: ['procedural'] },
    ]);
    expect(outcome.stdout.join('\n')).not.toContain('MRR>=0.5');
    expect(outcome.stdout.join('\n')).not.toContain('threshold_passed');
  });

  it('passes a drop equal to the epsilon', () => {
    const { path, measurement, scope } = writeHigherBaseline(tempDir());
    const outcome = evaluateRanking({
      measurement: measurementWithLowerMacro(measurement, 'procedural', MRR_DROP_EPSILON),
      scope,
      seededBenchmarkIds: scope.corpusBenchmarkIds,
      embeddingProvider: 'minilm',
      baselinePath: path,
      elapsedMs: 10,
      writeBaseline: false,
    });
    expect(outcome.mode).toBe('pass');
  });

  it('returns only mismatch when scored query ids differ, even if MRR also dropped', () => {
    const { path, measurement, scope } = writeHigherBaseline(tempDir());
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      identity: { scored_query_ids: Record<string, string[]> };
    };
    parsed.identity.scored_query_ids.procedural = ['q-other'];
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
    const outcome = evaluateRanking({
      measurement: measurementWithLowerMacro(measurement, 'procedural', 0.2),
      scope,
      seededBenchmarkIds: scope.corpusBenchmarkIds,
      embeddingProvider: 'minilm',
      baselinePath: path,
      elapsedMs: 10,
      writeBaseline: false,
    });
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes).toEqual([
      { kind: 'ranking', reason: 'mismatch', field: 'scored_query_ids' },
    ]);
  });

  it('returns only mismatch when a macro key is missing from the baseline', () => {
    const { path, measurement, scope } = writeHigherBaseline(tempDir());
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      identity: { scored_query_ids: Record<string, string[]> };
      metrics: { mrr_by_macro: Record<string, number> };
    };
    delete parsed.identity.scored_query_ids.tag_filter;
    delete parsed.metrics.mrr_by_macro.tag_filter;
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
    const outcome = evaluateRanking({
      measurement: measurementWithLowerMacro(measurement, 'procedural', 0.2),
      scope,
      seededBenchmarkIds: scope.corpusBenchmarkIds,
      embeddingProvider: 'minilm',
      baselinePath: path,
      elapsedMs: 10,
      writeBaseline: false,
    });
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes.map((cause) => cause.reason)).toEqual(['mismatch']);
  });

  it('fails missing_baseline when the file is absent and does not apply an absolute floor', () => {
    const measurement = measurementFrom({ ...baseMrr, procedural: 0.1 });
    const scope = prScope(measurement);
    const outcome = evaluateRanking({
      measurement,
      scope,
      seededBenchmarkIds: scope.corpusBenchmarkIds,
      embeddingProvider: 'minilm',
      baselinePath: join(tempDir(), 'missing.json'),
      elapsedMs: 10,
      writeBaseline: false,
    });
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes).toEqual([{ kind: 'ranking', reason: 'missing_baseline' }]);
  });

  it('rejects a baseline that smuggles threshold_passed', () => {
    const { path, measurement, scope } = writeHigherBaseline(tempDir());
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    parsed.threshold_passed = true;
    writeFileSync(path, `${JSON.stringify(parsed)}\n`);
    expect(() =>
      evaluateRanking({
        measurement,
        scope,
        seededBenchmarkIds: scope.corpusBenchmarkIds,
        embeddingProvider: 'minilm',
        baselinePath: path,
        elapsedMs: 10,
        writeBaseline: false,
      }),
    ).toThrow(/threshold_passed/);
  });

  it('can report coverage and wall beside mrr_drop', () => {
    const { path, measurement, scope } = writeHigherBaseline(tempDir());
    const lowered = measurementWithLowerMacro(measurement, 'conceptual', 0.031);
    const thin = {
      ...lowered,
      reports: lowered.reports.map((row) =>
        row.macro_category === 'conceptual' ? { ...row, authored_query_count: 2 } : row,
      ),
    };
    const outcome = evaluateRanking({
      measurement: thin,
      scope,
      seededBenchmarkIds: scope.corpusBenchmarkIds,
      embeddingProvider: 'minilm',
      baselinePath: path,
      elapsedMs: 30_001,
      writeBaseline: false,
    });
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes.map((cause) => cause.reason)).toEqual(['mrr_drop', 'coverage', 'wall']);
  });
});

describe('evaluatePerf', () => {
  function perfInput(searchWallMs: readonly number[], rssBytes: number, path: string, writeBaseline: boolean) {
    return {
      embeddingProvider: 'minilm' as const,
      corpusRowCount: PERF_CORPUS_ROWS,
      searchWallMs,
      rssBytes,
      baselinePath: path,
      writeBaseline,
    };
  }

  it('fails p95 when the search wall is just over 2× the baseline', () => {
    const path = join(tempDir(), 'perf.json');
    expect(evaluatePerf(perfInput([10, 10, 10], 1_000, path, true)).mode).toBe('write');
    const inflated = 10 * PERF_P95_SLACK + 0.1;
    const outcome = evaluatePerf(perfInput([inflated, inflated, inflated], 1_000, path, false));
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes).toEqual([{ kind: 'perf', reason: 'p95' }]);
  });

  it('fails rss when resident bytes are just over 1.5× and leaves a faster wall alone', () => {
    const path = join(tempDir(), 'perf.json');
    evaluatePerf(perfInput([10, 10], 1_000, path, true));
    const outcome = evaluatePerf(perfInput([9, 9], 1_000 * PERF_RSS_SLACK + 1, path, false));
    expect(outcome.mode).toBe('fail');
    if (outcome.mode !== 'fail') return;
    expect(outcome.causes).toEqual([{ kind: 'perf', reason: 'rss' }]);
  });

  it('passes a search wall equal to 2×', () => {
    const path = join(tempDir(), 'perf.json');
    evaluatePerf(perfInput([10], 1_000, path, true));
    const outcome = evaluatePerf(perfInput([20], 1_000, path, false));
    expect(outcome.mode).toBe('pass');
  });

  it('rejects an empty search wall instead of treating p95 as 0', () => {
    expect(() => evaluatePerf(perfInput([], 1_000, join(tempDir(), 'perf.json'), true))).toThrow(/empty/);
  });
});

describe('planRankingRun', () => {
  it('keeps every relevant id and fills the rest up to the PR cap in sha256 order', () => {
    const dir = tempDir();
    const ids = Array.from({ length: 420 }, (_, index) => `bench_${String(index).padStart(4, '0')}`);
    const relevant = [ids[10]!, ids[20]!];
    writeFileSync(
      join(dir, 'corpus.jsonl'),
      ids
        .map((id) => JSON.stringify({ benchmark_id: id, source_memory_id: id, content: id }))
        .join('\n') + '\n',
    );
    writeFileSync(
      join(dir, 'queries.json'),
      JSON.stringify([{ query_id: 'q1', query: 'alpha search' }]),
    );
    writeFileSync(
      join(dir, 'ground-truth.json'),
      JSON.stringify([{ queryId: 'q1', relevantIds: relevant }]),
    );
    const scope = planRankingRun('pr', dir);
    expect(scope.queryIds).toEqual(['alpha search']);
    expect(scope.corpusBenchmarkIds).toHaveLength(PR_CORPUS_CAP);
    expect(scope.corpusBenchmarkIds).toEqual([...scope.corpusBenchmarkIds].sort());
    for (const id of relevant) {
      expect(scope.corpusBenchmarkIds).toContain(id);
    }
    const distractors = ids
      .filter((id) => !relevant.includes(id))
      .sort((a, b) => sha256(a).localeCompare(sha256(b)) || a.localeCompare(b));
    const expected = [...relevant, ...distractors.slice(0, PR_CORPUS_CAP - relevant.length)].sort();
    expect(scope.corpusBenchmarkIds).toEqual(expected);
  });

  it('uses the full corpus for nightly', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const ids = ['b', 'a'];
    writeFileSync(
      join(dir, 'corpus.jsonl'),
      ids
        .map((id) => JSON.stringify({ benchmark_id: id, source_memory_id: id, content: id }))
        .join('\n') + '\n',
    );
    writeFileSync(join(dir, 'queries.json'), JSON.stringify([{ query_id: 'q1', query: 'q1' }]));
    writeFileSync(
      join(dir, 'ground-truth.json'),
      JSON.stringify([{ queryId: 'q1', relevantIds: ['a'] }]),
    );
    const scope = planRankingRun('nightly', dir);
    expect(scope.corpusBenchmarkIds).toEqual(['a', 'b']);
    expect(scope.name).toBe('nightly');
  });
});

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
