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
  conclusion: 'do_not_expand' | 'exploratory' | 'inconclusive_harness';
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
    conclusion: 'exploratory',
    reason:
      `오염된 held-out: 1차 측정에서 held-out을 본 뒤 점수식·그리드·선택 규칙을 바꿨고 진단도 held-out 기준이었다. ` +
      `held-out Recall@10 delta=${gainHeld.toFixed(3)}(참고용), 회귀@10=${regressionCount}건. 운영 확대 판단 없음.`,
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

    for (const outcome of [...devA, ...devBfs, ...heldA, ...heldBfs]) {
      assertZeroSafetyViolations(outcome.safetyViolations, `eval:${outcome.queryId}`);
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
  const heldA = report.heldOut.hybridOnly.byCategory;
  const heldB = report.heldOut.hybridWithBfs.byCategory;
  const sfA = heldA.find((r) => r.category === 'single_fact')?.metrics;
  const sfB = heldB.find((r) => r.category === 'single_fact')?.metrics;
  const partialMetricRegression =
    sfA && sfB
      ? `| single_fact held-out | Recall@5 | ${sfA.recallAt5.toFixed(3)} | ${sfB.recallAt5.toFixed(3)} | ` +
        `${sfB.recallAt5 >= sfA.recallAt5 ? '유지/상승' : '하락'} |\n` +
        `| single_fact held-out | nDCG@10 | ${sfA.ndcgAt10.toFixed(3)} | ${sfB.ndcgAt10.toFixed(3)} | ` +
        `${sfB.ndcgAt10 >= sfA.ndcgAt10 ? '유지/상승' : '하락'} |`
      : '';
  return `# relation BFS 검색 효용 측정 (#1555 3단계)

라벨: ${report.labelSource}

고정 BFS 설정(dev 튜닝 결과, held-out 재튜닝 없음): maxHops=${hyper.maxHops}, maxSeeds=${hyper.maxSeeds}, bfsLimit=${hyper.bfsLimit}

후보 풀=${EVAL_CONSTANTS.candidatePoolLimit}, 토큰 예산=${EVAL_CONSTANTS.tokenBudget}, k=5/10.

memory_relation 적재 건수(relations.jsonl): ${report.relationRowCount}

## 결론

\`${report.conclusion}\` — ${report.conclusionReason}

운영 BFS 확대 여부는 본 PR에서 판단하지 않는다. 숫자는 fixture 재현용 탐색(exploratory) 결과다.

## held-out 오염 (프로토콜)

1차 측정에서 held-out split을 본 뒤 BFS 점수식·dev 그리드·\`pickBestHyperparamsOnDev\` 규칙·multi_hop 진단을 수정했다. 아래 held-out 표는 **오염된 held-out** 참고용이며, 깨끗한 held-out 일반화 주장에 쓰지 않는다.

## 안전 (harness vs 운영)

본 harness는 \`expandPoolWithBfs\`·\`filterHybridItemsForBfsArm\`·\`finalizeRanked\`에서 query별 forbidden·scope owner·삭제/교체 메타를 **반환 풀**에서 제거한다. 운영 \`relation-graph-traversal.ts\`의 \`getRelatedMemories\`와 hybrid recall 경로에는 동일 필터가 없다. fixture에서 safety violation 0( forbidden·foreign owner·deleted/교체 집계)은 **고정 fixture + harness 후처리**일 뿐 운영 안전성 증명이 아니다.

## 1차 측정이 multi_hop 0이었던 원인 (harness, 재측정 전)

1차 run은 BFS가 동작해도 지표가 0으로 나왔다. 원인과 수정은 다음과 같다.

| 구분 | 1차 문제 | 수정 (ad92a548) |
|---|---|---|
| 관계 적재 | fixture DB에 \`memory_relation\` 미적재·건수 불일치 가능 | \`seedRelationGraphFromCorpusAndJsonl\`, relations.jsonl **205**건=DB (\`relation-bfs-eval-diagnostic.spec.ts\`) |
| BFS 병합·점수 | hybrid 30 뒤에 BFS append 후 trim → BFS 전량 탈락; \`0.5^hop\`·첫 seed만 점수 유지 → gold merged idx 34 | merge 후 score 정렬; \`scoreBfsCandidate\`(경로 edge confidence×type boost); seed 간 **max** \`finalScore\` |
| 그리드 | maxHops 1~2, multi_hop 2-hop 미도달 | maxHops **1~3**, dev **multi_hop R@10** 우선 튜닝 |
| 실행 순서 | hybrid 전량 선행 → B 지연·토큰 왜곡 | warm-up, hybrid cache, 그리드 latency off, A/B **교대** latency |

## multi_hop held-out R@10=0.176에 그친 이유 (진단)

held-out multi_hop 17건: **hop_obs는 hybrid top-3 시드 17/17** (시드 3개에 출발 노드 누락 아님). BFS @10 hit **3/17**. 나머지는 2-hop gold가 merged pool에는 들어와도 동일 hybrid 점수대의 타 클러스터 \`hop_obs\`·trap·direct가 상위 30·@10을 채워 \`hop_ans\`가 밀린다.

## dev BFS 그리드 (held-out 미사용)

dev 18조합 중 **h2/h3**, **s3/s5**, **l15~l35**는 multi_hop·overall R@10이 각각 동일해 판별력이 없다(동점 시 key tie-break).

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

### held-out @10 회귀 외 지표 (single_fact, 오염된 held-out)

| slice | metric | hybrid | hybrid+BFS | 비고 |
|---|---|---:|---:|---|
${partialMetricRegression}

지연은 warm-up 이후 쿼리별 A/B **교대** 재측정(\`measurePairedSearchLatencies\`) 값이다.

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
