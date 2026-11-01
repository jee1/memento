#!/usr/bin/env node
/**
 * #1555 stage 3: hybrid-only vs hybrid + RelationGraphTraversal BFS on relation-ko-panel-v1.
 * Offline fixture DB only. Does not change production search defaults.
 *
 * Usage:
 *   npm run build -w @memento/core
 *   npm run quality -- benchmark:relation-bfs
 *   npx tsx scripts/evaluate-relation-bfs.ts -- --write-report docs/testing/ko/relation-bfs-eval-report.md
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/cli.js';
import { withBenchmarkClock } from './lib/benchmark-clock.js';
import {
  assertZeroSafetyViolations,
  computeAggregateMetrics,
  computeMetricsByCategory,
  findRegressionQueryIds,
  type AggregateMetrics,
  type CategorySliceMetrics,
} from './lib/relation-bfs-eval-metrics.js';
import {
  DEFAULT_BFS_TUNE_GRID,
  evaluateQueryHybridOnly,
  evaluateQueryHybridWithBfs,
  hyperKey,
  pickBestHyperparamsOnDev,
  type RelationBfsEvalContext,
  type RelationBfsHyperparams,
} from './lib/relation-bfs-eval-runner.js';
import {
  buildBenchmarkIdMaps,
  createSeededRelationKoPanelDatabase,
  loadRelationKoPanelCorpusRows,
  loadRelationKoPanelForbiddenByQuery,
  loadRelationKoPanelGroundTruth,
  loadRelationKoPanelQueries,
  loadRelationKoPanelSplit,
} from './lib/relation-ko-panel-seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'tests/fixtures/search-quality/relation-ko-panel-v1');

export const EVAL_CONSTANTS = {
  candidatePoolLimit: 30,
  tokenBudget: 4096,
} as const;

export interface RelationBfsEvalReport {
  fixture: string;
  labelSource: string;
  chosenHyperparams: RelationBfsHyperparams;
  dev: SplitReport;
  heldOut: SplitReport;
  conclusion: 'do_not_expand' | 'marginal_gain_review';
  syntheticLimitation: string;
}

export interface SplitReport {
  hybridOnly: ArmReport;
  hybridWithBfs: ArmReport;
  regressionQueryIdsAt10: string[];
}

export interface ArmReport {
  overall: AggregateMetrics;
  byCategory: CategorySliceMetrics[];
}

export function formatMetricsTable(rows: CategorySliceMetrics[]): string {
  const header =
    '| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |\n' +
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|';
  const body = rows
    .map((row) => {
      const m = row.metrics;
      return `| ${row.category} | ${m.queryCount} | ${m.recallAt5.toFixed(3)} | ${m.recallAt10.toFixed(3)} | ` +
        `${m.ndcgAt5.toFixed(3)} | ${m.ndcgAt10.toFixed(3)} | ${m.latencyP50Ms.toFixed(1)} | ` +
        `${m.latencyP95Ms.toFixed(1)} | ${m.meanReturnedTokens.toFixed(1)} |`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

export function decideConclusion(
  devA: AggregateMetrics,
  devB: AggregateMetrics,
  heldA: AggregateMetrics,
  heldB: AggregateMetrics,
  regressionCount: number,
): RelationBfsEvalReport['conclusion'] {
  const gainHeld = heldB.recallAt10 - heldA.recallAt10;
  const gainDev = devB.recallAt10 - devA.recallAt10;
  if (gainHeld <= 0 && gainDev <= 0) {
    return 'do_not_expand';
  }
  if (regressionCount > 0 && regressionCount > Math.max(0, Math.round(gainHeld * heldA.queryCount))) {
    return 'do_not_expand';
  }
  if (gainHeld <= 0.01) {
    return 'do_not_expand';
  }
  return 'marginal_gain_review';
}

function buildGroundTruthMap(raw: Map<string, { relevantIds: string[] }>) {
  return new Map(
    [...raw.entries()].map(([queryId, value]) => [queryId, { queryId, relevantIds: value.relevantIds }]),
  );
}

export async function runRelationBfsEvaluation(
  fixtureDir: string = FIXTURE_DIR,
): Promise<RelationBfsEvalReport> {
  const split = loadRelationKoPanelSplit(fixtureDir);
  const queries = loadRelationKoPanelQueries(fixtureDir);
  const queryById = new Map(queries.map((q) => [q.query_id, q]));
  const rawGt = loadRelationKoPanelGroundTruth(fixtureDir);
  const groundTruths = buildGroundTruthMap(rawGt);
  const forbiddenByQueryId = loadRelationKoPanelForbiddenByQuery(fixtureDir);
  const corpus = loadRelationKoPanelCorpusRows(fixtureDir);
  const { memoryIdToBenchmarkId, contentByBenchmarkId } = buildBenchmarkIdMaps(corpus);

  const seeded = await createSeededRelationKoPanelDatabase(fixtureDir);
  const ctx: RelationBfsEvalContext = {
    db: seeded.db,
    memoryIdToBenchmarkId,
    contentByBenchmarkId,
    safetyMetaByBenchmarkId: seeded.safetyMetaByBenchmarkId,
    forbiddenByQueryId,
    constants: { ...EVAL_CONSTANTS },
  };

  try {
    const hybridOnlyByQuery = new Map<string, Awaited<ReturnType<typeof evaluateQueryHybridOnly>>>();
    for (const queryId of [...split.devQueryIds, ...split.heldOutQueryIds]) {
      const row = queryById.get(queryId);
      if (!row) {
        throw new Error(`Missing query row: ${queryId}`);
      }
      hybridOnlyByQuery.set(queryId, await evaluateQueryHybridOnly(ctx, row));
    }

    const devOutcomesByHyper = new Map<string, Awaited<ReturnType<typeof evaluateQueryHybridWithBfs>>[]>();
    for (const hyper of DEFAULT_BFS_TUNE_GRID) {
      const outcomes = [];
      for (const queryId of split.devQueryIds) {
        const row = queryById.get(queryId)!;
        outcomes.push(await evaluateQueryHybridWithBfs(ctx, row, hyper));
      }
      devOutcomesByHyper.set(hyperKey(hyper), outcomes);
    }

    const chosen = pickBestHyperparamsOnDev(devOutcomesByHyper, rawGt);

    const devBfs = devOutcomesByHyper.get(hyperKey(chosen))!;
    const heldBfs: typeof devBfs = [];
    for (const queryId of split.heldOutQueryIds) {
      const row = queryById.get(queryId)!;
      heldBfs.push(await evaluateQueryHybridWithBfs(ctx, row, chosen));
    }

    for (const outcome of [...devBfs, ...heldBfs]) {
      assertZeroSafetyViolations(outcome.safetyViolations, `bfs:${outcome.queryId}`);
    }

    const devA = split.devQueryIds.map((id) => hybridOnlyByQuery.get(id)!);
    const heldA = split.heldOutQueryIds.map((id) => hybridOnlyByQuery.get(id)!);

    const devReport: SplitReport = {
      hybridOnly: {
        overall: computeAggregateMetrics(devA, groundTruths),
        byCategory: computeMetricsByCategory(devA, groundTruths),
      },
      hybridWithBfs: {
        overall: computeAggregateMetrics(devBfs, groundTruths),
        byCategory: computeMetricsByCategory(devBfs, groundTruths),
      },
      regressionQueryIdsAt10: findRegressionQueryIds(devA, devBfs, groundTruths, 10),
    };

    const heldReport: SplitReport = {
      hybridOnly: {
        overall: computeAggregateMetrics(heldA, groundTruths),
        byCategory: computeMetricsByCategory(heldA, groundTruths),
      },
      hybridWithBfs: {
        overall: computeAggregateMetrics(heldBfs, groundTruths),
        byCategory: computeMetricsByCategory(heldBfs, groundTruths),
      },
      regressionQueryIdsAt10: findRegressionQueryIds(heldA, heldBfs, groundTruths, 10),
    };

    return {
      fixture: fixtureDir,
      labelSource: 'agent_panel (relation-ko-panel-v1, not human gold)',
      chosenHyperparams: chosen,
      dev: devReport,
      heldOut: heldReport,
      conclusion: decideConclusion(
        devReport.hybridOnly.overall,
        devReport.hybridWithBfs.overall,
        heldReport.hybridOnly.overall,
        heldReport.hybridWithBfs.overall,
        heldReport.regressionQueryIdsAt10.length,
      ),
      syntheticLimitation:
        '합성 relation-ko-panel-v1 그래프는 운영 관계 분포를 대표하지 않는다. 본 숫자는 fixture 재현 비교이며 운영 검색 품질 향상 주장에 쓰지 않는다.',
    };
  } finally {
    seeded.close();
  }
}

export function renderMarkdownReport(report: RelationBfsEvalReport): string {
  const hyper = report.chosenHyperparams;
  return `# relation BFS 검색 효용 측정 (#1555 3단계)

라벨: ${report.labelSource}

고정 BFS 설정(dev 튜닝 결과, held-out 재튜닝 없음): maxHops=${hyper.maxHops}, maxSeeds=${hyper.maxSeeds}, bfsLimit=${hyper.bfsLimit}

후보 풀=${EVAL_CONSTANTS.candidatePoolLimit}, 토큰 예산=${EVAL_CONSTANTS.tokenBudget}, k=5/10.

## 결론

\`${report.conclusion}\` — held-out Recall@10 delta=${(report.heldOut.hybridWithBfs.overall.recallAt10 - report.heldOut.hybridOnly.overall.recallAt10).toFixed(3)}, 회귀(held-out, A hit B miss @10)=${report.heldOut.regressionQueryIdsAt10.length}건.

## dev (n=${report.dev.hybridOnly.overall.queryCount})

### hybrid 단독

${formatMetricsTable(report.dev.hybridOnly.byCategory)}

### hybrid + BFS

${formatMetricsTable(report.dev.hybridWithBfs.byCategory)}

회귀 query_id (A hit, B miss @10): ${report.dev.regressionQueryIdsAt10.length ? report.dev.regressionQueryIdsAt10.join(', ') : '없음'}

## held-out (n=${report.heldOut.hybridOnly.overall.queryCount})

### hybrid 단독

${formatMetricsTable(report.heldOut.hybridOnly.byCategory)}

### hybrid + BFS

${formatMetricsTable(report.heldOut.hybridWithBfs.byCategory)}

회귀 query_id (A hit, B miss @10): ${report.heldOut.regressionQueryIdsAt10.length ? report.heldOut.regressionQueryIdsAt10.join(', ') : '없음'}

## 한계

${report.syntheticLimitation}
`;
}

async function main(): Promise<void> {
  const writeReport = process.argv.includes('--write-report');
  const reportArgIdx = process.argv.indexOf('--write-report');
  const reportPath =
    reportArgIdx >= 0 && process.argv[reportArgIdx + 1] && !process.argv[reportArgIdx + 1]!.startsWith('-')
      ? process.argv[reportArgIdx + 1]!
      : join(ROOT, 'docs/testing/ko/relation-bfs-eval-report.md');

  const report = await withBenchmarkClock(() => runRelationBfsEvaluation());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (writeReport) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, renderMarkdownReport(report), 'utf8');
    process.stderr.write(`[relation-bfs-eval] wrote ${reportPath}\n`);
  }
}

if (isMain(import.meta.url)) {
  if (!existsSync(join(FIXTURE_DIR, 'corpus.jsonl'))) {
    throw new Error(`Fixture missing: ${FIXTURE_DIR}`);
  }
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
