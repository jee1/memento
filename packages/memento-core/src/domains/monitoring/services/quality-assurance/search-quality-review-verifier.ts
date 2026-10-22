import {
  buildBenchmarkQueryLookup,
  loadBenchmarkCategoryMapping,
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
  loadBenchmarkManifest,
  loadBenchmarkQueries,
  type BenchmarkCategoryMapping,
  type BenchmarkCorpusEntry,
  type BenchmarkQuery,
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

export function knowledgeUpdatePairIds(groundTruth: GroundTruth): { freshId: string; staleId: string } {
  const freshId = groundTruth.relevantIds.length === 1 ? groundTruth.relevantIds[0] : undefined;
  const staleId = groundTruth.staleIds?.length === 1 ? groundTruth.staleIds[0] : undefined;
  if (freshId === undefined || staleId === undefined) {
    throw new Error(
      `knowledge_update query requires exactly one fresh id and one stale id: ${groundTruth.queryId}`,
    );
  }
  return { freshId, staleId };
}

/** Corpus rows store `YYYY-MM-DD HH:MM:SS` as well as ISO. Only the first space becomes `T`. */
function parseCorpusCreatedAt(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value.replace(' ', 'T'));
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isKnowledgeUpdateQuery(query: BenchmarkQuery, mapping: BenchmarkCategoryMapping): boolean {
  const override = mapping.query_overrides?.[query.query_id];
  if (override !== undefined) {
    return override === 'knowledge_update';
  }
  const label = mapping.query_id_to_category[query.query_id];
  if (label === undefined) {
    return false;
  }
  return (mapping.macro_categories.knowledge_update ?? []).includes(label);
}

function knowledgeUpdateChronologyErrors(
  query: BenchmarkQuery,
  groundTruth: GroundTruth,
  corpusById: ReadonlyMap<string, BenchmarkCorpusEntry>,
): string[] {
  let freshId: string;
  let staleId: string;
  try {
    ({ freshId, staleId } = knowledgeUpdatePairIds(groundTruth));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const errors: string[] = [];
  const fresh = corpusById.get(freshId);
  const stale = corpusById.get(staleId);
  if (!stale) {
    errors.push(`Stale ID not found in corpus: ${staleId}`);
  }
  if (!fresh || !stale) {
    return errors;
  }
  const freshAt = parseCorpusCreatedAt(fresh.created_at);
  const staleAt = parseCorpusCreatedAt(stale.created_at);
  if (freshAt === undefined || staleAt === undefined) {
    errors.push(`knowledge_update ${query.query_id}: created_at is not a timestamp`);
    return errors;
  }
  if (freshAt <= staleAt) {
    errors.push(`knowledge_update ${query.query_id}: fresh created_at must be later than stale created_at`);
  }
  return errors;
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

  const mapping = loadBenchmarkCategoryMapping(benchmarkDir);
  if (mapping) {
    const corpusById = new Map(corpus.map((entry) => [entry.benchmark_id, entry]));
    for (const query of queries) {
      if (!isKnowledgeUpdateQuery(query, mapping)) {
        continue;
      }
      const groundTruth = groundTruths.find(
        (row) => row.queryId === query.query || row.queryId === query.query_id,
      );
      if (!groundTruth) {
        continue;
      }
      errors.push(...knowledgeUpdateChronologyErrors(query, groundTruth, corpusById));
    }
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
      } else {
        const groundTruth = matchingGroundTruths[0];
        if (groundTruth && groundTruth.relevantIds.length === 0) {
          errors.push(
            `ground_truth_reviewed=true requires non-empty relevantIds for query: ${groundTruth.queryId}`
          );
        }
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
