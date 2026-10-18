#!/usr/bin/env node
/**
 * #1400: 기각 게이트 임계값 곡선. 점수는 캐시(공개 픽스처) 또는 라벨 팩(비공개)에서만 읽는다.
 * 라벨 팩은 search_id 를 출력하지 않고 집계만 낸다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { sqliteRepositoryProvider, mementoConfig } from '@memento/core';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import { createRelevanceGate } from '../packages/memento-core/src/domains/search/services/relevance-gate/create-relevance-gate.js';
import { getBenchmarkVectorProviderFilter } from '@memento/core/shared/types/benchmark.types.js';
import { loadBenchmarkManifest } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { isMain, parseArgs } from './lib/cli.js';
import { createRejectionBaselineDatabase, REJECTION_BASELINE_DIR } from './lib/rejection-baseline-database.js';
import {
  REJECTION_BASELINE_TOP_K,
  loadRejectionBaselineQueries,
} from './lib/rejection-baseline-measurement.js';
import {
  isGateScoreCacheCurrent,
  parseGateScoreCache,
  parseLabelPack,
  sweepRejectionThresholds,
  type GateScoreCache,
  type RejectionSweepReport,
} from './lib/rejection-sweep.js';

const DEFAULT_CACHE_PATH = '.local/rejection-sweep/public-gate-scores.json';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function currentCacheKey(): Pick<GateScoreCache, 'benchmark_version' | 'gate'> {
  const manifest = loadBenchmarkManifest(REJECTION_BASELINE_DIR) as { benchmark_version: string };
  return {
    benchmark_version: manifest.benchmark_version,
    gate: {
      provider: 'typesafe',
      model: mementoConfig.typesafeModel,
      doc_chars: mementoConfig.searchRejectionGateDocChars,
    },
  };
}

async function scorePublicFixture(key: Pick<GateScoreCache, 'benchmark_version' | 'gate'>): Promise<GateScoreCache> {
  const gate = createRelevanceGate();
  if (!gate) {
    throw new Error('게이트를 만들 수 없습니다. SEARCH_REJECTION_GATE=typesafe 와 TYPESAFE_API_KEY 를 설정하세요.');
  }
  const seeded = await createRejectionBaselineDatabase();
  try {
    const engine = HybridSearchFactory.createDefaultEngine(sqliteRepositoryProvider);
    engine.setRejectionGate(gate);
    const rows: GateScoreCache['rows'] = [];
    for (const q of loadRejectionBaselineQueries(REJECTION_BASELINE_DIR)) {
      const result = await engine.search(seeded.db, {
        query: q.query,
        limit: REJECTION_BASELINE_TOP_K,
        provider_filter: getBenchmarkVectorProviderFilter(),
      });
      rows.push({ query_id: q.query_id, group: q.group, top_score: result.rejection_gate?.top_score ?? null });
    }
    return { schema_version: 1, ...key, rows };
  } finally {
    seeded.close();
  }
}

async function loadPublicScores(cachePath: string, refresh: boolean): Promise<GateScoreCache> {
  const key = currentCacheKey();
  if (!refresh && existsSync(cachePath)) {
    try {
      const cached = parseGateScoreCache(readJson(cachePath));
      if (isGateScoreCacheCurrent(cached, key)) {
        return cached;
      }
    } catch {
      // 깨진 캐시는 재채점으로 덮어쓴다
    }
  }
  const fresh = await scorePublicFixture(key);
  mkdirSync(dirname(resolve(cachePath)), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
  return fresh;
}

const LABEL_PACK_NOTES = [
  '모집단은 임계값 0.5 에서 게이트가 기각한 운영 질의다(전부 top_score < 0.5). 비율은 이 모집단에 조건부이며, t ≥ 0.5 에서는 구성상 모든 행이 기각된다.',
  't ≤ 0.5 에서 임계값 사이 기각 건수 차이는 정확하다. 라벨 팩 밖의 질의(top_score ≥ 0.5)는 그 구간 어느 임계값에서도 통과하기 때문이다.',
  '평가자 1인, 표본이 작다. Wilson 95% 구간이 넓다.',
];

export async function runRejectionSweep(options: {
  labelsPath?: string;
  cachePath?: string;
  refresh?: boolean;
}): Promise<RejectionSweepReport> {
  if (options.labelsPath) {
    const { rows, excluded } = parseLabelPack(readJson(options.labelsPath));
    const { counts, curve } = sweepRejectionThresholds(rows);
    return {
      schema_version: 1,
      source: { kind: 'label-pack' },
      counts: { ...counts, excluded },
      curve,
      notes: LABEL_PACK_NOTES,
    };
  }
  const cache = await loadPublicScores(options.cachePath ?? DEFAULT_CACHE_PATH, options.refresh ?? false);
  const { counts, curve } = sweepRejectionThresholds(cache.rows);
  const unscored = counts.unscored.relevant + counts.unscored.unrelated;
  if (unscored > 0) {
    process.stderr.write(`[rejection-sweep] 점수 없는 질의 ${unscored}건(fail-open 또는 후보 0건). 기각으로 세지 않는다.\n`);
  }
  return {
    schema_version: 1,
    source: { kind: 'fixture', benchmark_version: cache.benchmark_version, gate: cache.gate },
    counts: { ...counts, excluded: 0 },
    curve,
    notes: [],
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      labels: { type: 'string' },
      cache: { type: 'string' },
      refresh: { type: 'boolean' },
      'json-out': { type: 'string' },
    },
  });
  const report = await runRejectionSweep({
    labelsPath: values.labels as string | undefined,
    cachePath: values.cache as string | undefined,
    refresh: values.refresh as boolean | undefined,
  });
  const json = JSON.stringify(report, null, 2);
  const jsonOut = values['json-out'] as string | undefined;
  if (jsonOut) {
    mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
    writeFileSync(jsonOut, `${json}\n`, 'utf8');
  }
  process.stdout.write(`${json}\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
