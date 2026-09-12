#!/usr/bin/env node
/**
 * #961: length-decay coefficient sweep (diagnostic, not a gate).
 * Seeds the benchmark corpus once, then loops k × arm × subset.
 * Exit code is always 0 — degradation is human-judged (plan §8 / §R9).
 *
 * arm=vector_dom forces vectorWeight:1 / textWeight:0 which AdaptiveWeightCalculator
 * maps to effective vector≈0.8 / text≈0.2 for multi-token queries (NOT vector-only).
 *
 * #961 R4: AdaptiveWeightCalculator caches weights by query string. Each collect()
 * creates a fresh engine via createDefaultEngine — do not refactor to reuse engines
 * across arms or arm B silently inherits arm A weights.
 */

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resetRankingWeightsCache } from '@memento/core/shared/config/ranking-weights-loader.js';
import { QualityMetricsCollector } from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.js';
import type { CategoryMetricsOptions } from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/category-quality-aggregator.js';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import { isMain } from './lib/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const MAPPING_PATH = join(BENCHMARK_DIR, 'category-mapping.json');
const BASE_TOML = join(ROOT, 'config/ranking-weights.toml');

const K_VALUES = [40, 80, 160, 320] as const;

type Arm = { name: 'hybrid' } | { name: 'vector_dom'; vectorWeight: number; textWeight: number };
type Subset = { name: 'all' } | { name: 'short'; maxGroundTruthLength: number };

const ARMS: Arm[] = [
  { name: 'hybrid' },
  { name: 'vector_dom', vectorWeight: 1, textWeight: 0 },
];

const SUBSETS: Subset[] = [
  { name: 'all' },
  { name: 'short', maxGroundTruthLength: 1024 },
];

function writeTomlForK(k: number, dir: string): string {
  const base = readFileSync(BASE_TOML, 'utf8');
  const patched = base.replace(
    /characteristic_length\s*=\s*\d+/,
    `characteristic_length = ${k}`
  );
  const out = join(dir, `ranking-weights-k${k}.toml`);
  writeFileSync(out, patched, 'utf8');
  return out;
}

function optionsFor(arm: Arm, subset: Subset): CategoryMetricsOptions {
  const opts: CategoryMetricsOptions = {};
  if (arm.name === 'vector_dom') {
    opts.vectorWeight = arm.vectorWeight;
    opts.textWeight = arm.textWeight;
  }
  if (subset.name === 'short') {
    opts.maxGroundTruthLength = subset.maxGroundTruthLength;
  }
  return opts;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'memento-sweep-961-'));
  // Keep a pristine copy in case BASE_TOML is mutated elsewhere; we only write patched files.
  copyFileSync(BASE_TOML, join(tmp, 'ranking-weights.base.toml'));

  const { db, close, embeddingProvider, vectorDims } = await createSeededBenchmarkDatabase(
    BENCHMARK_DIR
  );

  try {
    console.log(`# embedding_provider=${embeddingProvider} vector_dims=${vectorDims}`);
    console.log(
      '# arm\tk\tsubset\tmacro\tn\tMRR\tNDCG@5\tNDCG@10\ttop10_len\tlong10pct'
    );

    const summary: Array<{
      arm: string;
      subset: string;
      macro: string;
      mrr40: number;
      minMrr: number;
      minK: number;
      delta: number;
    }> = [];

    for (const k of K_VALUES) {
      const tomlPath = writeTomlForK(k, tmp);
      process.env.MEMENTO_RANKING_WEIGHTS_PATH = tomlPath;
      resetRankingWeightsCache();

      for (const arm of ARMS) {
        for (const subset of SUBSETS) {
          // Fresh collector → fresh engine per arm (R4 cache warning above).
          const collector = new QualityMetricsCollector(db);
          const reports = await collector.collectCategoryMetrics(
            BENCHMARK_DIR,
            MAPPING_PATH,
            optionsFor(arm, subset)
          );

          for (const r of reports) {
            console.log(
              [
                arm.name,
                k,
                subset.name,
                r.macro_category,
                r.query_count,
                r.mrr.toFixed(4),
                r.ndcg_at_5.toFixed(4),
                r.ndcg_at_10.toFixed(4),
                r.mean_top10_content_length.toFixed(0),
                (r.mean_top10_long_doc_ratio * 100).toFixed(1) + '%',
              ].join('\t')
            );

            if (k === 40) {
              summary.push({
                arm: arm.name,
                subset: subset.name,
                macro: r.macro_category,
                mrr40: r.mrr,
                minMrr: r.mrr,
                minK: 40,
                delta: 0,
              });
            } else {
              const row = summary.find(
                (s) =>
                  s.arm === arm.name &&
                  s.subset === subset.name &&
                  s.macro === r.macro_category
              );
              if (row && r.mrr < row.minMrr) {
                row.minMrr = r.mrr;
                row.minK = k;
                row.delta = r.mrr - row.mrr40;
              }
            }
          }
        }
      }
    }

    console.log('# summary Δ MRR (k40 → lowest among {80,160,320}; 0 if never below k40)');
    console.log('# arm\tsubset\tmacro\tmrr40\tmin_mrr\tmin_k\tdelta');
    for (const s of summary) {
      console.log(
        [
          s.arm,
          s.subset,
          s.macro,
          s.mrr40.toFixed(4),
          s.minMrr.toFixed(4),
          s.minK,
          s.delta.toFixed(4),
        ].join('\t')
      );
    }
  } finally {
    close();
    delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    resetRankingWeightsCache();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    // Diagnostic report: still exit 0 so CI does not pressure numbers (plan §R9).
    process.exit(0);
  });
}
