#!/usr/bin/env node
/**
 * macro_category별 MRR·NDCG 리포트 (CI 게이트: MRR < 0.5 → exit 1)
 *
 * SC-006: `started` 이후 구간(시드 완료 후 collectCategoryMetrics~stdout)이 WALL_MS 초과 시 non-zero exit.
 * 이는 본 스크립트 집계 벽시계만 해당하며, 전체 CI 워크플로 총 벽시계는 측정하지 않는다(spec.md).
 *
 * DB는 DB_PATH가 아니라 benchmark-v3 corpus를 시드한 임시 SQLite만 사용한다(오프라인 품질 신호).
 * 시드 시 EMBEDDING_PROVIDER 미설정이면 tfidf(빠른 CI)를 쓴다.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSeededBenchmarkDatabase } from '@memento/core/test/helpers/benchmark-search-database.js';
import { QualityMetricsCollector } from '@memento/core/domains/monitoring/services/quality-assurance/quality-metrics-collector.js';
import type { CategoryQualityReport } from '@memento/core/shared/types/benchmark.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const MAPPING_PATH = join(BENCHMARK_DIR, 'category-mapping.json');

/** 벽시계 상한 (SC-006) — 테스트에서 동일 값으로 검증 */
export const WALL_MS = 30_000;

export function formatCategoryReportLine(r: CategoryQualityReport): string {
  const gate = r.threshold_passed ? 'PASS' : 'FAIL';
  return `${r.macro_category} | ${r.query_count} | ${r.mrr.toFixed(4)} | ${r.ndcg_at_5.toFixed(4)} | ${r.ndcg_at_10.toFixed(4)} | ${gate}`;
}

export function anyCategoryFailsMrrGate(reports: CategoryQualityReport[]): boolean {
  return reports.some((x) => !x.threshold_passed);
}

async function main(): Promise<void> {
  const { db, close } = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
  /** SC-006: 코퍼스 시드 시간은 제외하고 집계·검색 구간만 측정 */
  const started = Date.now();
  let exitCode = 0;
  try {
    const collector = new QualityMetricsCollector(db);
    const reports = await collector.collectCategoryMetrics(BENCHMARK_DIR, MAPPING_PATH);

    console.log('macro_category | queries | MRR | NDCG@5 | NDCG@10 | MRR>=0.5');
    const fail = anyCategoryFailsMrrGate(reports);
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

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
