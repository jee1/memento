import {
  buildBenchmarkQueryLookup,
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
  loadBenchmarkManifest,
  loadBenchmarkQueries,
} from './search-quality-benchmark-fixtures.js';
import type { GroundTruth } from './search-quality-metrics.js';

export interface ReviewVerificationResult {
  ok: boolean;
  errors: string[];
  summary: {
    queryCount: number;
    groundTruthCount: number;
    corpusSize: number;
    reviewed: boolean;
  };
}

export interface ReviewVerificationOptions {
  requireReviewed?: boolean;
}

export function normalizeBenchmarkGroundTruths(
  benchmarkDir: string,
  groundTruths = loadBenchmarkGroundTruth(benchmarkDir)
): GroundTruth[] {
  const lookup = buildBenchmarkQueryLookup(loadBenchmarkQueries(benchmarkDir));

  return groundTruths.map((groundTruth) => {
    const resolvedQuery =
      lookup.byId.get(groundTruth.queryId)?.query ??
      lookup.byQueryText.get(groundTruth.queryId)?.query;

    return resolvedQuery
      ? {
          ...groundTruth,
          queryId: resolvedQuery,
        }
      : groundTruth;
  });
}

export function verifyReviewableBenchmark(
  benchmarkDir: string,
  options: ReviewVerificationOptions = {}
): ReviewVerificationResult {
  const manifest = loadBenchmarkManifest(benchmarkDir);
  const queries = loadBenchmarkQueries(benchmarkDir);
  const groundTruths = loadBenchmarkGroundTruth(benchmarkDir);
  const corpus = loadBenchmarkCorpus(benchmarkDir);

  const errors: string[] = [];
  const corpusIds = new Set(corpus.map((entry) => entry.benchmark_id));
  const lookup = buildBenchmarkQueryLookup(queries);
  const queryTexts = new Set(queries.map((query) => query.query));
  const queryIds = new Set(queries.map((query) => query.query_id));

  for (const groundTruth of groundTruths) {
    if (!queryTexts.has(groundTruth.queryId) && !queryIds.has(groundTruth.queryId)) {
      errors.push(`Ground truth queryId not found in queries.json: ${groundTruth.queryId}`);
    } else if (queryIds.has(groundTruth.queryId) && !lookup.byId.get(groundTruth.queryId)?.query) {
      errors.push(`Ground truth queryId is not resolvable to query text: ${groundTruth.queryId}`);
    }

    for (const relevantId of groundTruth.relevantIds) {
      if (!corpusIds.has(relevantId)) {
        errors.push(`Relevant ID not found in corpus: ${relevantId}`);
      }
    }
  }

  if (manifest.query_count !== queries.length) {
    errors.push(`Manifest query_count mismatch: expected ${queries.length}, got ${manifest.query_count}`);
  }

  if (manifest.ground_truth_count !== groundTruths.length) {
    errors.push(`Manifest ground_truth_count mismatch: expected ${groundTruths.length}, got ${manifest.ground_truth_count}`);
  }

  if (manifest.corpus_size !== corpus.length) {
    errors.push(`Manifest corpus_size mismatch: expected ${corpus.length}, got ${manifest.corpus_size}`);
  }

  if (options.requireReviewed && manifest.ground_truth_reviewed !== true) {
    errors.push('Benchmark is not marked as reviewed (ground_truth_reviewed=false)');
  }

  if (manifest.ground_truth_reviewed === true) {
    if (groundTruths.length === 0) {
      errors.push('ground_truth_reviewed=true requires at least one ground truth entry');
    }

    for (const query of queries) {
      const matchingGroundTruths = groundTruths.filter(
        (groundTruth) => groundTruth.queryId === query.query || groundTruth.queryId === query.query_id
      );
      if (matchingGroundTruths.length === 0) {
        errors.push(`ground_truth_reviewed=true requires a ground truth entry for query ${query.query_id}`);
      } else if (matchingGroundTruths.length > 1) {
        errors.push(`ground_truth_reviewed=true requires exactly one ground truth entry for query ${query.query_id}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      queryCount: queries.length,
      groundTruthCount: groundTruths.length,
      corpusSize: corpus.length,
      reviewed: manifest.ground_truth_reviewed === true,
    },
  };
}
