#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * macro_category별 MRR·NDCG 리포트 (CI 게이트: MRR < 0.5 → exit 1)
 *
 * SC-006: `started` 이후 구간(시드 완료 후 collectCategoryMetrics~stdout)이 WALL_MS 초과 시 non-zero exit.
 * 이는 본 스크립트 집계 벽시계만 해당하며, 전체 CI 워크플로 총 벽시계는 측정하지 않는다(spec.md).
 *
 * DB는 DB_PATH가 아니라 benchmark-v3 corpus를 시드한 임시 SQLite만 사용한다(오프라인 품질 신호).
 * 시드·검색 provider는 EMBEDDING_PROVIDER(unset→minilm)를 따른다(#905).
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import { QualityMetricsCollector } from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.js';
import type { CategoryQualityReport } from '../packages/memento-core/src/shared/types/benchmark.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const MAPPING_PATH = join(BENCHMARK_DIR, 'category-mapping.json');

/** 벽시계 상한 (SC-006) — 테스트에서 동일 값으로 검증 */
export const WALL_MS = 30_000;

/** #934: 작성된 쿼리는 전부 채점돼야 한다. 빈 relevantIds 추가 시 즉시 CI 실패 (fail-closed) */
export const MIN_QUERY_COVERAGE = 1.0;

const REQUIRED_MACRO_CATEGORIES: CategoryQualityReport['macro_category'][] = [
  'episodic_recent',
  'procedural',
  'conceptual',
  'tag_filter',
];

export function formatCoverageLine(reports: CategoryQualityReport[]): string {
  const scored = reports.reduce((s, r) => s + r.query_count, 0);
  const authored = reports.reduce((s, r) => s + r.authored_query_count, 0);
  const coverage = authored > 0 ? scored / authored : 0;
  return `queries_authored=${authored} queries_scored=${scored} coverage=${coverage.toFixed(3)}`;
}

export function coverageBelowThreshold(reports: CategoryQualityReport[]): boolean {
  const scored = reports.reduce((s, r) => s + r.query_count, 0);
  const authored = reports.reduce((s, r) => s + r.authored_query_count, 0);
  return authored === 0 || scored / authored < MIN_QUERY_COVERAGE;
}

export function formatCategoryReportLine(r: CategoryQualityReport): string {
  const gate = r.threshold_passed ? 'PASS' : 'FAIL';
  return `${r.macro_category} | ${r.query_count}/${r.authored_query_count} | ${r.mrr.toFixed(4)} | ${r.ndcg_at_5.toFixed(4)} | ${r.ndcg_at_10.toFixed(4)} | ${r.mean_top10_content_length.toFixed(0)} | ${gate}`;
}

/** #905 contract: embedding_provider=<name> vector_dims=<n> */
export function formatEmbeddingRunHeader(provider: string, vectorDims: number): string {
  return `embedding_provider=${provider} vector_dims=${vectorDims}`;
}

export function anyCategoryFailsMrrGate(reports: CategoryQualityReport[]): boolean {
  const reportedCategories = new Set(reports.map((report) => report.macro_category));
  return (
    REQUIRED_MACRO_CATEGORIES.some((category) => !reportedCategories.has(category)) ||
    reports.some((report) => !report.threshold_passed)
  );
}

async function main(): Promise<void> {
  const { db, close, embeddingProvider, vectorDims } = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
  /** SC-006: 코퍼스 시드 시간은 제외하고 집계·검색 구간만 측정 */
  const started = Date.now();
  let exitCode = 0;
  try {
    const collector = new QualityMetricsCollector(db);
    const reports = await collector.collectCategoryMetrics(BENCHMARK_DIR, MAPPING_PATH);

    console.log(formatEmbeddingRunHeader(embeddingProvider, vectorDims));
    console.log(formatCoverageLine(reports));
    console.log('macro_category | scored/authored | MRR | NDCG@5 | NDCG@10 | top10_len | MRR>=0.5');
    const coverageFail = coverageBelowThreshold(reports);
    const fail = anyCategoryFailsMrrGate(reports) || coverageFail;
    if (coverageFail) {
      console.error(
        `Coverage below ${MIN_QUERY_COVERAGE}: ${formatCoverageLine(reports)} (empty relevantIds or missing GT)`
      );
    }
    for (const r of reports) {
      console.log(formatCategoryReportLine(r));
    }

    const elapsed = Date.now() - started;
    if (elapsed > WALL_MS) {
      console.error(
        `SC-006: post-seed category-report segment wall time ${elapsed}ms exceeds ${WALL_MS}ms (measured: collectCategoryMetrics through report output; excludes seed and full CI workflow)`
      );
      exitCode = 1;
    } else if (fail) {
      exitCode = 1;
    }
  } finally {
    close();
  }
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
