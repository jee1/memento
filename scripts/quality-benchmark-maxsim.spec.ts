import { describe, expect, it } from 'vitest';
import {
  loadBenchmarkGroundTruth,
  loadBenchmarkQueries,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { calculateMRR } from '@memento/core/domains/monitoring/services/quality-assurance/search-metrics-collector.js';
import type { GroundTruth } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-metrics.js';
import { resolveQualityCommand } from './quality.js';
import {
  rankByScore,
  scoreCorpus,
  type MaxsimDocVectors,
} from './lib/maxsim-measurement.js';
import { BENCHMARK_V3_DIR } from './lib/rejection-baseline-database.js';
import { buildMaxsimReport } from './quality-benchmark-maxsim.js';

const REQUIRED_MACROS = ['incident_ops', 'procedural', 'conceptual', 'tag_filter'] as const;

function makeRanking(ids: string[]): Array<{ id: string; score: number }> {
  return ids.map((id, index) => ({ id, score: 1 - index * 0.01 }));
}

function makeFullRankingWithAnswerAt(
  corpusSize: number,
  answerId: string,
  answerRank: number
): Array<{ id: string; score: number }> {
  const ranking: Array<{ id: string; score: number }> = [];
  let noise = 0;
  for (let rank = 1; rank <= corpusSize; rank++) {
    if (rank === answerRank) {
      ranking.push({ id: answerId, score: 1 });
    } else {
      ranking.push({
        id: `bench_noise_full_${String(noise).padStart(4, '0')}`,
        score: 1 - rank * 0.0001,
      });
      noise++;
    }
  }
  return ranking;
}

describe('quality-benchmark-maxsim (issue 1107)', () => {
  it('registers benchmark:maxsim in quality CLI', () => {
    const command = resolveQualityCommand(['benchmark:maxsim']);
    expect(command.script).toBe('quality-benchmark-maxsim.ts');
  });

  it('buildMaxsimReport aggregates fixture macros, ranks, and overall MRR', () => {
    const queries = loadBenchmarkQueries(BENCHMARK_V3_DIR);
    const groundTruths = loadBenchmarkGroundTruth(BENCHMARK_V3_DIR).filter(
      (groundTruth) => groundTruth.relevantIds.length > 0
    );
    const q001 = queries.find((query) => query.query_id === 'q_001');
    const q002 = queries.find((query) => query.query_id === 'q_002');
    const q003 = queries.find((query) => query.query_id === 'q_003');
    expect(q001).toBeDefined();
    expect(q002).toBeDefined();
    expect(q003).toBeDefined();

    const gt001 = groundTruths.find((groundTruth) => groundTruth.queryId === q001!.query);
    const gt002 = groundTruths.find((groundTruth) => groundTruth.queryId === q002!.query);
    const gt003 = groundTruths.find((groundTruth) => groundTruth.queryId === q003!.query);
    expect(gt001?.relevantIds[0]).toBe('bench_syn_ans_0001');
    expect(gt002?.relevantIds[0]).toBe('bench_syn_ans_0002');
    expect(gt003?.relevantIds[0]).toBe('bench_mem_003421');

    const filler = Array.from({ length: 20 }, (_, index) => `bench_noise_${String(index).padStart(4, '0')}`);

    const q001MeanRanking = makeRanking([
      ...filler.slice(0, 1),
      gt001!.relevantIds[0]!,
      ...filler.slice(1, 20),
    ]);
    const q001MaxsimRanking = makeRanking([gt001!.relevantIds[0]!, ...filler]);
    const q002Ranking = makeRanking([gt002!.relevantIds[0]!, ...filler.slice(0, 19)]);
    const q003Ranking = makeRanking(filler);

    const perQuery = [
      {
        queryId: q001!.query_id,
        queryText: q001!.query,
        meanRanking: q001MeanRanking,
        maxsimRanking: q001MaxsimRanking,
        meanRankingFull: q001MeanRanking,
        maxsimRankingFull: q001MaxsimRanking,
      },
      {
        queryId: q002!.query_id,
        queryText: q002!.query,
        meanRanking: q002Ranking,
        maxsimRanking: q002Ranking,
        meanRankingFull: q002Ranking,
        maxsimRankingFull: q002Ranking,
      },
      {
        queryId: q003!.query_id,
        queryText: q003!.query,
        meanRanking: q003Ranking,
        maxsimRanking: q003Ranking,
        meanRankingFull: q003Ranking,
        maxsimRankingFull: q003Ranking,
      },
    ];

    const corpusStats = {
      documentCount: 3,
      multiWindowDocumentCount: 1,
      totalWindowVectors: 4,
      maxWindowCount: 2,
      indexGrowthPercent: 33.333333333333336,
      reproductionMismatchCount: 0,
      elapsedMs: 1,
    };

    const report = buildMaxsimReport({
      benchmarkDir: BENCHMARK_V3_DIR,
      model: 'minilm',
      corpusStats,
      perQuery,
    });

    expect(report.macro.map((row) => row.macro_category)).toEqual([...REQUIRED_MACROS]);
    expect(report.macro.find((row) => row.macro_category === 'incident_ops')?.query_count).toBe(7);
    expect(report.macro.find((row) => row.macro_category === 'tag_filter')?.query_count).toBe(6);
    expect(report.macro.find((row) => row.macro_category === 'procedural')?.query_count).toBe(6);
    expect(report.macro.find((row) => row.macro_category === 'conceptual')?.query_count).toBe(10);

    const row001 = report.queries.find((row) => row.query_id === 'q_001');
    expect(row001?.macro_category).toBe('incident_ops');
    expect(row001?.mean_rank).toBe(2);
    expect(row001?.maxsim_rank).toBe(1);
    expect(row001?.rank_delta).toBe(1);

    const row003 = report.queries.find((row) => row.query_id === 'q_003');
    expect(row003?.mean_rank).toBeNull();
    expect(row003?.maxsim_rank).toBeNull();
    expect(row003?.rank_delta).toBeNull();

    const meanMap = new Map<string, Array<{ id: string; score: number }>>();
    const maxsimMap = new Map<string, Array<{ id: string; score: number }>>();
    for (const groundTruth of groundTruths) {
      const match = perQuery.find((row) => row.queryText === groundTruth.queryId);
      if (match) {
        meanMap.set(groundTruth.queryId, match.meanRanking);
        maxsimMap.set(groundTruth.queryId, match.maxsimRanking);
      }
    }
    const expectedMeanMrr = calculateMRR(
      new Map(
        [...meanMap.entries()].map(([queryId, ranking]) => [
          queryId,
          ranking.map((row) => ({ id: row.id, score: row.score })),
        ])
      ),
      groundTruths as GroundTruth[]
    );
    const expectedMaxsimMrr = calculateMRR(
      new Map(
        [...maxsimMap.entries()].map(([queryId, ranking]) => [
          queryId,
          ranking.map((row) => ({ id: row.id, score: row.score })),
        ])
      ),
      groundTruths as GroundTruth[]
    );
    expect(report.overall.mean_mrr).toBe(expectedMeanMrr);
    expect(report.overall.maxsim_mrr).toBe(expectedMaxsimMrr);
    expect(expectedMeanMrr).toBeCloseTo(1.5 / groundTruths.length, 10);
    expect(expectedMaxsimMrr).toBeCloseTo(2 / groundTruths.length, 10);
  });

  it('buildMaxsimReport exposes full-corpus ranks and recall@k when answer is outside top 20', () => {
    const queries = loadBenchmarkQueries(BENCHMARK_V3_DIR);
    const groundTruths = loadBenchmarkGroundTruth(BENCHMARK_V3_DIR).filter(
      (groundTruth) => groundTruth.relevantIds.length > 0
    );
    const q001 = queries.find((query) => query.query_id === 'q_001');
    expect(q001).toBeDefined();

    const gt001 = groundTruths.find((groundTruth) => groundTruth.queryId === q001!.query);
    expect(gt001?.relevantIds[0]).toBe('bench_syn_ans_0001');

    const answerId = gt001!.relevantIds[0]!;
    const corpusSize = 350;
    const filler = Array.from({ length: 19 }, (_, index) =>
      `bench_noise_${String(index).padStart(4, '0')}`
    );
    const meanRankingFull = makeFullRankingWithAnswerAt(corpusSize, answerId, 300);
    const maxsimRankingFull = makeFullRankingWithAnswerAt(corpusSize, answerId, 12);
    const meanRanking = makeRanking(filler);
    const maxsimRanking = makeRanking([...filler.slice(0, 11), answerId, ...filler.slice(11)]);

    const perQuery = groundTruths.map((groundTruth) => {
      if (groundTruth.queryId === q001!.query) {
        return {
          queryId: q001!.query_id,
          queryText: q001!.query,
          meanRanking,
          maxsimRanking,
          meanRankingFull,
          maxsimRankingFull,
        };
      }
      const noiseId = `bench_placeholder_${groundTruth.queryId}`;
      const placeholderRanking = makeRanking([noiseId, ...filler.slice(0, 19)]);
      return {
        queryId: groundTruth.queryId,
        queryText: groundTruth.queryId,
        meanRanking: placeholderRanking,
        maxsimRanking: placeholderRanking,
        meanRankingFull: placeholderRanking,
        maxsimRankingFull: placeholderRanking,
      };
    });

    const report = buildMaxsimReport({
      benchmarkDir: BENCHMARK_V3_DIR,
      model: 'minilm',
      corpusStats: {
        documentCount: corpusSize,
        multiWindowDocumentCount: 0,
        totalWindowVectors: corpusSize,
        maxWindowCount: 1,
        indexGrowthPercent: 0,
        reproductionMismatchCount: 0,
        elapsedMs: 1,
      },
      perQuery,
    });

    const row001 = report.queries.find((row) => row.query_id === 'q_001');
    expect(row001?.mean_rank).toBeNull();
    expect(row001?.maxsim_rank).toBe(12);
    expect(row001?.mean_rank_full).toBe(300);
    expect(row001?.maxsim_rank_full).toBe(12);
    expect(row001?.rank_full_delta).toBe(288);

    expect(report.overall.improved_count).toBeGreaterThanOrEqual(1);
    expect(
      report.queries.filter((row) => row.rank_full_delta !== null && row.rank_full_delta > 0).length
    ).toBe(report.overall.improved_count);

    expect(report.overall.maxsim_recall_at['100']).toBeGreaterThan(
      report.overall.mean_recall_at['100']
    );
    expect(report.overall.maxsim_recall_at['10']).toBe(report.overall.mean_recall_at['10']);
  });

  it('scoreCorpus prefers matching window over mean pooling and rankByScore breaks ties by benchmarkId', () => {
    const queryVector = new Float32Array([1, 0, 0]);
    const docHighMean: MaxsimDocVectors = {
      benchmarkId: 'bench_z',
      memoryId: 'mem_z',
      contentLength: 10,
      meanVector: new Float32Array([0.95, 0.31, 0]),
      windows: [new Float32Array([0.95, 0.31, 0])],
    };
    const docMaxsimWin: MaxsimDocVectors = {
      benchmarkId: 'bench_a',
      memoryId: 'mem_a',
      contentLength: 20,
      meanVector: new Float32Array([0.5, 0.87, 0]),
      windows: [
        new Float32Array([0.5, 0.87, 0]),
        new Float32Array([1, 0, 0]),
      ],
    };

    const scored = scoreCorpus(queryVector, [docHighMean, docMaxsimWin]);
    const byMean = scored.find((row) => row.benchmarkId === 'bench_z');
    const byMaxsim = scored.find((row) => row.benchmarkId === 'bench_a');
    expect(byMean?.meanScore).toBeGreaterThan(byMaxsim?.meanScore ?? 0);
    expect(byMaxsim?.maxsimScore).toBeGreaterThan(byMean?.maxsimScore ?? 0);

    const tiedDocs: MaxsimDocVectors[] = [
      {
        benchmarkId: 'bench_b',
        memoryId: 'mem_b',
        contentLength: 1,
        meanVector: new Float32Array([0.8, 0, 0]),
        windows: [new Float32Array([0.8, 0, 0])],
      },
      {
        benchmarkId: 'bench_a',
        memoryId: 'mem_a2',
        contentLength: 1,
        meanVector: new Float32Array([0.8, 0, 0]),
        windows: [new Float32Array([0.8, 0, 0])],
      },
    ];
    const tiedScored = scoreCorpus(queryVector, tiedDocs);
    const ranked = rankByScore(tiedScored, 'maxsimScore', 2);
    expect(ranked.map((row) => row.id)).toEqual(['bench_a', 'bench_b']);
  });
});
