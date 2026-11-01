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
  type PerQueryEvalOutcome,
} from './lib/relation-bfs-eval-metrics.js';
import {
  buildDevGridRows,
  DEFAULT_BFS_TUNE_GRID,
  DEFAULT_RELATION_BFS_EVAL_CONSTANTS,
  evaluateQueryHybridOnly,
  evaluateQueryHybridWithBfs,
  formatDevGridMarkdown,
  hyperKey,
  measurePairedSearchLatencies,
  pickBestHyperparamsOnDev,
  runHybridSearch,
  type DevGridRow,
  type HybridSearchSnapshot,
  type RelationBfsEvalContext,
  type RelationBfsHyperparams,
} from './lib/relation-bfs-eval-runner.js';
import {
  buildBenchmarkIdMaps,
  countRelationJsonlRows,
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

export const EVAL_CONSTANTS = DEFAULT_RELATION_BFS_EVAL_CONSTANTS;

export interface RelationBfsEvalReport {
  fixture: string;
  labelSource: string;
  relationRowCount: number;
  devGrid: DevGridRow[];
  chosenHyperparams: RelationBfsHyperparams;
  dev: SplitReport;
  heldOut: SplitReport;
  conclusion: 'do_not_expand' | 'marginal_gain_review' | 'inconclusive_harness';
  conclusionReason: string;
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
  devGrid: readonly DevGridRow[],
  chosen: RelationBfsHyperparams,
  heldA: AggregateMetrics,
  heldB: AggregateMetrics,
  regressionCount: number,
): { conclusion: RelationBfsEvalReport['conclusion']; reason: string } {
  const bestMulti = devGrid.find((row) => hyperKey(row.hyper) === hyperKey(chosen))?.multiHopRecallAt10 ?? 0;
  if (bestMulti <= 0) {
    return {
      conclusion: 'inconclusive_harness',
      reason:
        'dev 그리드에서 multi_hop Recall@10>0 인 BFS 설정이 없다. BFS가 gold hop 정답에 닿지 않거나 최종 풀/랭킹에 반영되지 않았을 수 있다.',
    };
  }
  const gainHeld = heldB.recallAt10 - heldA.recallAt10;
  if (gainHeld <= 0) {
    return {
      conclusion: 'do_not_expand',
      reason: `held-out Recall@10 delta=${gainHeld.toFixed(3)}, 회귀=${regressionCount}건`,
    };
  }
  if (regressionCount > 0 && regressionCount > Math.max(0, Math.round(gainHeld * heldA.queryCount))) {
    return {
      conclusion: 'do_not_expand',
      reason: `held-out 이득 대비 회귀 과다(delta=${gainHeld.toFixed(3)}, 회귀=${regressionCount})`,
    };
  }
  if (gainHeld <= 0.01) {
    return {
      conclusion: 'do_not_expand',
      reason: `held-out Recall@10 delta=${gainHeld.toFixed(3)} (≤0.01)`,
    };
  }
  return {
    conclusion: 'marginal_gain_review',
    reason: `held-out Recall@10 delta=${gainHeld.toFixed(3)}, 회귀=${regressionCount}건`,
  };
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
    embeddingProvider: seeded.embeddingProvider,
    memoryIdToBenchmarkId,
    contentByBenchmarkId,
    safetyMetaByBenchmarkId: seeded.safetyMetaByBenchmarkId,
    forbiddenByQueryId,
    constants: { ...EVAL_CONSTANTS },
  };

  try {
    const relationRowCount = countRelationJsonlRows(fixtureDir);
    const queryCategoryById = new Map(queries.map((q) => [q.query_id, q.category]));
    const allQueryIds = [...split.devQueryIds, ...split.heldOutQueryIds];

    const hybridCache = new Map<string, HybridSearchSnapshot>();
    const warmUpRow = queryById.get(split.devQueryIds[0]!);
    if (warmUpRow) {
      await runHybridSearch(ctx, warmUpRow);
    }
    for (const queryId of allQueryIds) {
      const row = queryById.get(queryId)!;
      const { items } = await runHybridSearch(ctx, row);
      hybridCache.set(queryId, { items });
    }

    const devOutcomesByHyper = new Map<string, Awaited<ReturnType<typeof evaluateQueryHybridWithBfs>>[]>();
    for (const hyper of DEFAULT_BFS_TUNE_GRID) {
      const outcomes = [];
      for (const queryId of split.devQueryIds) {
        const row = queryById.get(queryId)!;
        outcomes.push(
          await evaluateQueryHybridWithBfs(ctx, row, hyper, hybridCache.get(queryId), false),
        );
      }
      devOutcomesByHyper.set(hyperKey(hyper), outcomes);
    }

    const devGrid = buildDevGridRows(devOutcomesByHyper, rawGt, queryCategoryById);
    const chosen = pickBestHyperparamsOnDev(devGrid);

    const applyLatencies = async (
      outcomes: PerQueryEvalOutcome[],
      queryIds: string[],
      arm: 'a' | 'b',
    ): Promise<void> => {
      for (let i = 0; i < queryIds.length; i++) {
        const queryId = queryIds[i]!;
        const row = queryById.get(queryId)!;
        const paired = await measurePairedSearchLatencies(ctx, row, chosen);
        const outcome = outcomes[i];
        if (!outcome) {
          continue;
        }
        outcome.latencyMs = arm === 'a' ? paired.hybridOnlyMs : paired.hybridWithBfsMs;
      }
    };

    const devBfs = devOutcomesByHyper.get(hyperKey(chosen))!;
    const devA = await Promise.all(
      split.devQueryIds.map((id) =>
        evaluateQueryHybridOnly(ctx, queryById.get(id)!, hybridCache.get(id)),
      ),
    );
    const heldA = await Promise.all(
      split.heldOutQueryIds.map((id) =>
        evaluateQueryHybridOnly(ctx, queryById.get(id)!, hybridCache.get(id)),
      ),
    );
    const heldBfs = await Promise.all(
      split.heldOutQueryIds.map((id) =>
        evaluateQueryHybridWithBfs(ctx, queryById.get(id)!, chosen, hybridCache.get(id), false),
      ),
    );

    for (const outcome of [...devBfs, ...heldBfs]) {
      assertZeroSafetyViolations(outcome.safetyViolations, `bfs:${outcome.queryId}`);
    }

    await applyLatencies(devA, split.devQueryIds, 'a');
    await applyLatencies(devBfs, split.devQueryIds, 'b');
    await applyLatencies(heldA, split.heldOutQueryIds, 'a');
    await applyLatencies(heldBfs, split.heldOutQueryIds, 'b');

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

    const { conclusion, reason: conclusionReason } = decideConclusion(
      devGrid,
      chosen,
      heldReport.hybridOnly.overall,
      heldReport.hybridWithBfs.overall,
      heldReport.regressionQueryIdsAt10.length,
    );

    return {
      fixture: fixtureDir,
      labelSource: 'agent_panel (relation-ko-panel-v1, not human gold)',
      relationRowCount,
      devGrid,
      chosenHyperparams: chosen,
      dev: devReport,
      heldOut: heldReport,
      conclusion,
      conclusionReason,
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

memory_relation 적재 건수(relations.jsonl): ${report.relationRowCount}

## 결론

\`${report.conclusion}\` — ${report.conclusionReason}

## dev BFS 그리드 (held-out 미사용)

${formatDevGridMarkdown(report.devGrid)}

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
