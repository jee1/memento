#!/usr/bin/env node

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  adaptLoCoMo,
  adaptLongMemEvalS,
  assertDatasetSafe,
  loadAgentMemoryFixture,
  type AgentMemoryBenchmarkDataset,
  type AgentMemoryBenchmarkGateThresholds,
  type AgentMemoryDocument,
  type AgentMemoryE2ECase,
  type AgentMemoryRetrievalQuery,
  type AgentMemoryTaskCase,
} from './agent-memory-benchmark-adapter.js';
import { meanFunnelGoldFraction, runProductionRecallBenchmark } from './agent-memory-production-adapter.js';

type BaselineName = 'grep' | 'fts_only' | 'vector' | 'rrf_sim' | 'memento_prod' | 'graph_rrf';

interface RankedDocument extends AgentMemoryDocument {
  tokenEstimate: number;
}

interface QueryEvaluation {
  queryId: string;
  relevantIds: string[];
  ranked: RankedDocument[];
  latencyMs: number;
}

export interface BaselineMetrics {
  query_count: number;
  top_k: number;
  recall_at_5: number;
  recall_at_10: number;
  mrr: number;
  ndcg_at_10: number;
  latency_ms: {
    p50: number;
    p95: number;
  };
  injected_tokens: {
    total: number;
    mean: number;
  };
  duplicate_rate: number;
  max_session_concentration: number;
}

/**
 * Per-category retrieval quality paired with the per-query injection cost.
 * Latency is omitted so the breakdown stays byte-stable across runs.
 */
export type CategoryMetrics = Omit<BaselineMetrics, 'latency_ms'>;

interface EndToEndMetrics {
  case_count: number;
  completion_rate: number;
  evidence_coverage: number;
  injected_tokens: {
    total: number;
    mean: number;
  };
}

interface GateCheck {
  name: string;
  threshold: number;
  observed: number;
  passed: boolean;
}

interface GraphGateReport {
  enabled: boolean;
  adoption_candidate: boolean;
  checks: GateCheck[];
}

export interface ProductionScorecard {
  dataset_revision: string;
  dataset_sha256: string;
  seed: number;
  ranking_profile: string;
  ranking_version: string;
  embedding_provider: string;
  production_path: string;
  query_count: number;
  abstention_count: number;
  non_abstention_query_count: number;
  recall_at_5: number;
  recall_at_10: number;
  /** Gold hit rate in FTS SQL candidates (`raw_text` funnel stage). */
  sql_candidate_recall: number;
  /** Gold hit rate after SearchEngine top-N (`text_topN` funnel stage). */
  engine_topn_recall: number;
  mrr: number;
  ndcg_at_10: number;
  latency_ms: { p50: number; p95: number };
  p95_budget_ms: number;
  failed_queries: string[];
}

export interface AgentMemoryBenchmarkReport {
  schema_version: 1;
  reproduction: {
    benchmark_version: string;
    fixture_dir: string;
    fixture_sha256: string;
    git_sha: string;
    node_version: string;
    platform: NodeJS.Platform;
    architecture: string;
    seed: number;
    graph_rrf: boolean;
    production?: boolean;
    ranking_version?: string;
    ranking_weights_path_override?: boolean;
    eligible_query_ids_sha256?: string;
    excluded_query_ids_sha256?: string;
    evaluator_revision?: string;
  };
  retrieval: Partial<Record<BaselineName, BaselineMetrics>>;
  by_category?: Partial<Record<BaselineName, Record<string, CategoryMetrics>>>;
  end_to_end: Partial<Record<BaselineName, EndToEndMetrics>>;
  gates: {
    graph_rrf: GraphGateReport;
    production_vs_fts: GraphGateReport;
  };
  scorecard?: ProductionScorecard;
}

export interface RunOptions {
  fixtureDir?: string;
  longMemEvalSPath?: string;
  loCoMoPath?: string;
  graphRrf?: boolean;
  seed?: number;
  production?: boolean;
}

interface CliOptions extends RunOptions {
  outputPath?: string;
  scorecardOut?: string;
}

const DEFAULT_FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu;
const RRF_K = 60;

export function tokenize(text: string): string[] {
  return (text.toLocaleLowerCase('en-US').match(TOKEN_PATTERN) ?? [])
    .map((token) => token.replace(/^[-_]+|[-_]+$/g, ''))
    .filter(Boolean);
}

export function reciprocalRankFusion(streams: string[][], k: number = RRF_K): string[] {
  const scores = new Map<string, number>();
  for (const stream of streams) {
    stream.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

export function evaluateRankedResults(
  results: QueryEvaluation[],
  topK: number,
  tokenBudget: number = Number.POSITIVE_INFINITY,
): BaselineMetrics {
  if (results.length === 0) {
    return emptyMetrics();
  }
  let recall5 = 0;
  let recall10 = 0;
  let reciprocalRank = 0;
  let ndcg10 = 0;
  let injectedTokens = 0;
  let duplicateCount = 0;
  let returnedCount = 0;
  let maxSessionConcentration = 0;

  for (const result of results) {
    const relevant = new Set(result.relevantIds);
    const ranked = result.ranked.slice(0, topK);
    const injected = selectWithinTokenBudget(ranked, tokenBudget);
    recall5 += recallAtK(ranked, relevant, 5);
    recall10 += recallAtK(ranked, relevant, 10);
    reciprocalRank += reciprocalRankFor(ranked, relevant);
    ndcg10 += ndcgAtK(ranked, relevant, 10);
    injectedTokens += injected.reduce((sum, item) => sum + item.tokenEstimate, 0);

    const contents = new Set<string>();
    const sessions = new Map<string, number>();
    for (const item of injected) {
      const canonical = canonicalContent(item.content);
      if (contents.has(canonical)) {
        duplicateCount++;
      } else {
        contents.add(canonical);
      }
      sessions.set(item.sessionId, (sessions.get(item.sessionId) ?? 0) + 1);
      returnedCount++;
    }
    const queryConcentration = injected.length === 0
      ? 0
      : Math.max(0, ...sessions.values()) / injected.length;
    maxSessionConcentration = Math.max(maxSessionConcentration, queryConcentration);
  }

  return {
    query_count: results.length,
    top_k: topK,
    recall_at_5: recall5 / results.length,
    recall_at_10: recall10 / results.length,
    mrr: reciprocalRank / results.length,
    ndcg_at_10: ndcg10 / results.length,
    latency_ms: {
      p50: percentile(results.map((result) => result.latencyMs), 0.5),
      p95: percentile(results.map((result) => result.latencyMs), 0.95),
    },
    injected_tokens: {
      total: injectedTokens,
      mean: injectedTokens / results.length,
    },
    duplicate_rate: returnedCount === 0 ? 0 : duplicateCount / returnedCount,
    max_session_concentration: maxSessionConcentration,
  };
}

export function evaluateGraphAdoptionGate(
  baseline: BaselineMetrics,
  graph: BaselineMetrics,
  thresholds: AgentMemoryBenchmarkGateThresholds,
): GraphGateReport {
  const checks: GateCheck[] = [
    minimumCheck(
      'recall_at_10_delta',
      thresholds.min_recall_at_10_delta,
      graph.recall_at_10 - baseline.recall_at_10,
    ),
    minimumCheck(
      'mrr_non_degradation',
      -thresholds.max_quality_regression,
      graph.mrr - baseline.mrr,
    ),
    minimumCheck(
      'ndcg_at_10_non_degradation',
      -thresholds.max_quality_regression,
      graph.ndcg_at_10 - baseline.ndcg_at_10,
    ),
    maximumCheck(
      'p95_latency_ms',
      thresholds.max_p95_latency_ms,
      graph.latency_ms.p95,
    ),
    maximumCheck(
      'p95_latency_ratio',
      thresholds.max_p95_latency_ratio,
      baseline.latency_ms.p95 > 0
        ? graph.latency_ms.p95 / baseline.latency_ms.p95
        : graph.latency_ms.p95 === 0 ? 1 : Number.POSITIVE_INFINITY,
    ),
    maximumCheck(
      'duplicate_rate',
      thresholds.max_duplicate_rate,
      graph.duplicate_rate,
    ),
    maximumCheck(
      'session_concentration',
      thresholds.max_session_concentration,
      graph.max_session_concentration,
    ),
  ];
  return {
    enabled: true,
    adoption_candidate: checks.every((check) => check.passed),
    checks,
  };
}

export function evaluateProductionVsFtsGate(
  ftsOnly: BaselineMetrics,
  production: BaselineMetrics,
  thresholds: AgentMemoryBenchmarkGateThresholds,
): GraphGateReport {
  const checks: GateCheck[] = [
    minimumCheck(
      'recall_at_10_non_degradation',
      -thresholds.max_quality_regression,
      production.recall_at_10 - ftsOnly.recall_at_10,
    ),
    minimumCheck(
      'mrr_non_degradation',
      -thresholds.max_quality_regression,
      production.mrr - ftsOnly.mrr,
    ),
    minimumCheck(
      'ndcg_at_10_non_degradation',
      -thresholds.max_quality_regression,
      production.ndcg_at_10 - ftsOnly.ndcg_at_10,
    ),
    maximumCheck(
      'p95_latency_ms',
      thresholds.max_p95_latency_ms,
      production.latency_ms.p95,
    ),
  ];
  return {
    enabled: true,
    adoption_candidate: checks.every((check) => check.passed),
    checks,
  };
}

export function loadDataset(options: RunOptions = {}): AgentMemoryBenchmarkDataset {
  if (options.loCoMoPath) {
    const path = resolve(options.loCoMoPath);
    return adaptLoCoMo(path, { sourceRevision: readAcquisitionRevision(path) });
  }
  if (options.longMemEvalSPath) {
    const path = resolve(options.longMemEvalSPath);
    return adaptLongMemEvalS(path, { sourceRevision: readAcquisitionRevision(path) });
  }
  return loadAgentMemoryFixture(resolve(options.fixtureDir ?? DEFAULT_FIXTURE_DIR));
}

/**
 * Acquisition scripts drop an `acquisition-receipt.json` beside the dataset.
 * Reading the revision from it keeps the report's provenance tied to the file
 * that was actually downloaded rather than to a constant in this repository.
 */
function readAcquisitionRevision(datasetPath: string): string | undefined {
  const receiptPath = join(dirname(datasetPath), 'acquisition-receipt.json');
  if (!existsSync(receiptPath)) {
    return undefined;
  }
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { revision?: unknown };
    return typeof receipt.revision === 'string' ? receipt.revision : undefined;
  } catch {
    return undefined;
  }
}

function datasetLabel(options: RunOptions, fixtureDir: string): string {
  const path = options.loCoMoPath ?? options.longMemEvalSPath;
  return path ? basename(resolve(path)) : fixtureDir;
}

export function runAgentMemoryBenchmark(options: RunOptions = {}): AgentMemoryBenchmarkReport {
  const fixtureDir = resolve(options.fixtureDir ?? DEFAULT_FIXTURE_DIR);
  const dataset = loadDataset(options);
  assertDatasetSafe(dataset);
  const seed = options.seed ?? dataset.manifest.seed;
  const topK = dataset.manifest.top_k;
  const graphRrf = options.graphRrf ?? false;
  const queryRankings = evaluateBaselines(dataset, topK, graphRrf);
  const retrieval: AgentMemoryBenchmarkReport['retrieval'] = {};
  const endToEnd: AgentMemoryBenchmarkReport['end_to_end'] = {};
  const byCategory: NonNullable<AgentMemoryBenchmarkReport['by_category']> = {};

  for (const [name, evaluations] of queryRankings) {
    retrieval[name] = evaluateRankedResults(
      evaluations,
      topK,
      dataset.manifest.token_budget,
    );
    endToEnd[name] = evaluateEndToEnd(
      dataset.e2eCases,
      dataset.queries,
      evaluations,
    );
    const categories = categoryBreakdown(
      evaluations,
      dataset.taskCases,
      topK,
      dataset.manifest.token_budget,
    );
    if (categories) {
      byCategory[name] = categories;
    }
  }

  const rrfSim = retrieval.rrf_sim ?? emptyMetrics();
  const graph = retrieval.graph_rrf;
  const graphGate = graphRrf && graph
    ? evaluateGraphAdoptionGate(rrfSim, graph, dataset.manifest.gates)
    : {
        enabled: false,
        adoption_candidate: false,
        checks: [],
      };

  return {
    schema_version: 1,
    reproduction: {
      benchmark_version: dataset.manifest.benchmark_version,
      fixture_dir: datasetLabel(options, fixtureDir),
      fixture_sha256: hashDataset(dataset),
      git_sha: readGitSha(),
      node_version: process.version,
      platform: process.platform,
      architecture: process.arch,
      seed,
      graph_rrf: graphRrf,
    },
    retrieval,
    ...(Object.keys(byCategory).length > 0 ? { by_category: byCategory } : {}),
    end_to_end: endToEnd,
    gates: {
      graph_rrf: graphGate,
      production_vs_fts: {
        enabled: false,
        adoption_candidate: false,
        checks: [],
      },
    },
  };
}

export async function runProductionAgentMemoryBenchmark(
  options: RunOptions = {},
): Promise<AgentMemoryBenchmarkReport> {
  const report = runAgentMemoryBenchmark(options);
  const dataset = loadDataset(options);
  const production = await runProductionRecallBenchmark(dataset, dataset.manifest.top_k);
  const metrics = evaluateRankedResults(
    production.evaluations,
    dataset.manifest.top_k,
    dataset.manifest.token_budget,
  );
  const abstentionCount = (dataset.taskCases ?? []).filter((testCase) => testCase.abstention).length;
  const failedQueries = production.evaluations
    .filter((evaluation) => !evaluation.ranked.some(
      (document) => evaluation.relevantIds.includes(document.id),
    ))
    .map((evaluation) => evaluation.queryId)
    .sort((a, b) => a.localeCompare(b));

  report.reproduction.production = true;
  report.reproduction.ranking_version = production.ranking_version;
  report.reproduction.ranking_weights_path_override = production.ranking_weights_path_override;
  report.reproduction.evaluator_revision = dataset.manifest.benchmark_version;
  report.reproduction.eligible_query_ids_sha256 = hashIdList(dataset.queries.map((query) => query.id));
  report.reproduction.excluded_query_ids_sha256 = hashIdList(excludedQueryIds(dataset));
  report.retrieval.memento_prod = metrics;
  report.end_to_end.memento_prod = evaluateEndToEnd(
    dataset.e2eCases,
    dataset.queries,
    production.evaluations,
  );
  const productionCategories = categoryBreakdown(
    production.evaluations,
    dataset.taskCases,
    dataset.manifest.top_k,
    dataset.manifest.token_budget,
  );
  if (productionCategories) {
    report.by_category = { ...report.by_category, memento_prod: productionCategories };
  }
  report.gates.production_vs_fts = evaluateProductionVsFtsGate(
    report.retrieval.fts_only ?? emptyMetrics(),
    metrics,
    dataset.manifest.gates,
  );
  report.scorecard = {
    production_path: production.production_path,
    dataset_revision: dataset.manifest.source_revision,
    dataset_sha256: report.reproduction.fixture_sha256,
    ranking_profile: production.ranking_profile,
    ranking_version: production.ranking_version,
    embedding_provider: production.embedding_provider,
    seed: report.reproduction.seed,
    query_count: metrics.query_count,
    abstention_count: abstentionCount,
    non_abstention_query_count: dataset.queries.length,
    recall_at_5: metrics.recall_at_5,
    recall_at_10: metrics.recall_at_10,
    sql_candidate_recall: meanFunnelGoldFraction(production.evaluations, 'raw_text'),
    engine_topn_recall: meanFunnelGoldFraction(production.evaluations, 'text_topN'),
    mrr: metrics.mrr,
    ndcg_at_10: metrics.ndcg_at_10,
    latency_ms: metrics.latency_ms,
    p95_budget_ms: dataset.manifest.gates.max_p95_latency_ms,
    failed_queries: failedQueries,
  };
  return report;
}

/**
 * Groups query evaluations by the question type recorded in `taskCases`, so a
 * report shows retrieval quality *and* the per-query injected token cost side by
 * side for each category (multi-session recall, temporal reasoning, ...).
 * Returns undefined when the dataset carries no task cases.
 */
export function categoryBreakdown(
  evaluations: QueryEvaluation[],
  taskCases: AgentMemoryTaskCase[] | undefined,
  topK: number,
  tokenBudget: number,
): Record<string, CategoryMetrics> | undefined {
  if (!taskCases || taskCases.length === 0) {
    return undefined;
  }
  const typeByQueryId = new Map(taskCases.map((testCase) => [testCase.id, testCase.questionType]));
  const grouped = new Map<string, QueryEvaluation[]>();
  for (const evaluation of evaluations) {
    const questionType = typeByQueryId.get(evaluation.queryId);
    if (!questionType) {
      continue;
    }
    grouped.set(questionType, [...(grouped.get(questionType) ?? []), evaluation]);
  }
  if (grouped.size === 0) {
    return undefined;
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([questionType, group]) => {
        const { latency_ms: _latency, ...metrics } = evaluateRankedResults(
          group,
          topK,
          tokenBudget,
        );
        return [questionType, metrics];
      }),
  );
}

export function deterministicProjection(report: AgentMemoryBenchmarkReport): unknown {
  return {
    schema_version: report.schema_version,
    benchmark_version: report.reproduction.benchmark_version,
    fixture_sha256: report.reproduction.fixture_sha256,
    seed: report.reproduction.seed,
    graph_rrf: report.reproduction.graph_rrf,
    retrieval: Object.fromEntries(
      Object.entries(report.retrieval).map(([name, metrics]) => [
        name,
        metrics ? {
          ...metrics,
          latency_ms: undefined,
        } : metrics,
      ]),
    ),
    by_category: report.by_category,
    end_to_end: report.end_to_end,
    gate_quality: report.gates.graph_rrf.checks.filter(
      (check) => !check.name.startsWith('p95_latency'),
    ),
  };
}

function evaluateBaselines(
  dataset: AgentMemoryBenchmarkDataset,
  topK: number,
  graphRrf: boolean,
): Map<BaselineName, QueryEvaluation[]> {
  const documentById = new Map(dataset.documents.map((document) => [document.id, document]));
  const byBaseline = new Map<BaselineName, QueryEvaluation[]>([
    ['grep', []],
    ['fts_only', []],
    ['vector', []],
    ['rrf_sim', []],
  ]);
  if (graphRrf) {
    byBaseline.set('graph_rrf', []);
  }

  for (const query of dataset.queries) {
    const scopedDocuments = query.scopeId
      ? dataset.documents.filter((document) => document.scopeId === query.scopeId)
      : dataset.documents;
    const vectorIndex = buildVectorIndex(scopedDocuments);
    const fts = createFtsIndex(scopedDocuments);
    try {
      const grepResult = timedRank(() => rankByGrep(scopedDocuments, query.query, topK));
      const ftsResult = timedRank(() => rankByFts(fts, query.query, topK));
      const vectorResult = timedRank(() => rankByVector(vectorIndex, query.query, topK));
      const rrfSimResult = timedRank(() => reciprocalRankFusion(
        [ftsResult.ids, vectorResult.ids],
      ).slice(0, topK));

      pushEvaluation(byBaseline, 'grep', query, grepResult.ids, grepResult.latencyMs, documentById);
      pushEvaluation(byBaseline, 'fts_only', query, ftsResult.ids, ftsResult.latencyMs, documentById);
      pushEvaluation(byBaseline, 'vector', query, vectorResult.ids, vectorResult.latencyMs, documentById);
      pushEvaluation(
        byBaseline,
        'rrf_sim',
        query,
        rrfSimResult.ids,
        ftsResult.latencyMs + vectorResult.latencyMs + rrfSimResult.latencyMs,
        documentById,
      );

      if (graphRrf) {
        const graphResult = timedRank(() => graphCandidates(
          [...new Set([...ftsResult.ids, ...vectorResult.ids])],
          dataset,
          topK,
        ));
        const fused = timedRank(() => reciprocalRankFusion([
          ftsResult.ids,
          vectorResult.ids,
          graphResult.ids,
        ]).slice(0, topK));
        pushEvaluation(
          byBaseline,
          'graph_rrf',
          query,
          fused.ids,
          ftsResult.latencyMs
            + vectorResult.latencyMs
            + graphResult.latencyMs
            + fused.latencyMs,
          documentById,
        );
      }
    } finally {
      fts.close();
    }
  }
  return byBaseline;
}

function pushEvaluation(
  target: Map<BaselineName, QueryEvaluation[]>,
  baseline: BaselineName,
  query: AgentMemoryRetrievalQuery,
  ids: string[],
  latencyMs: number,
  documentById: Map<string, AgentMemoryDocument>,
): void {
  target.get(baseline)?.push({
    queryId: query.id,
    relevantIds: query.relevantIds,
    ranked: ids.flatMap((id) => {
      const document = documentById.get(id);
      return document
        ? [{ ...document, tokenEstimate: estimateTokens(document.content) }]
        : [];
    }),
    latencyMs,
  });
}

function rankByGrep(
  documents: AgentMemoryDocument[],
  query: string,
  limit: number,
): string[] {
  const queryTokens = [...new Set(tokenize(query))];
  return documents
    .map((document) => {
      const content = document.content.toLocaleLowerCase('en-US');
      const score = queryTokens.reduce(
        (sum, token) => sum + literalOccurrences(content, token),
        0,
      );
      return { id: document.id, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((item) => item.id);
}

function createFtsIndex(documents: AgentMemoryDocument[]): {
  db: Database.Database;
  close: () => void;
} {
  const db = new Database(':memory:');
  db.exec('CREATE VIRTUAL TABLE documents USING fts5(id UNINDEXED, content, session_id UNINDEXED)');
  const insert = db.prepare('INSERT INTO documents (id, content, session_id) VALUES (?, ?, ?)');
  const transaction = db.transaction((rows: AgentMemoryDocument[]) => {
    for (const document of rows) {
      insert.run(document.id, document.content, document.sessionId);
    }
  });
  transaction(documents);
  return { db, close: () => db.close() };
}

function rankByFts(
  fts: { db: Database.Database },
  query: string,
  limit: number,
): string[] {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) {
    return [];
  }
  const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
  const rows = fts.db.prepare(`
    SELECT id, bm25(documents) AS rank
    FROM documents
    WHERE documents MATCH ?
    ORDER BY rank ASC, id ASC
    LIMIT ?
  `).all(match, limit) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

interface VectorIndex {
  documents: AgentMemoryDocument[];
  inverseDocumentFrequency: Map<string, number>;
  vectors: Map<string, Map<string, number>>;
}

function buildVectorIndex(documents: AgentMemoryDocument[]): VectorIndex {
  const documentTokens = documents.map((document) => ({
    id: document.id,
    counts: tokenCounts(tokenize(document.content)),
  }));
  const documentFrequency = new Map<string, number>();
  for (const { counts } of documentTokens) {
    for (const token of counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const inverseDocumentFrequency = new Map(
    [...documentFrequency].map(([token, count]) => [
      token,
      Math.log((documents.length + 1) / (count + 1)) + 1,
    ]),
  );
  const vectors = new Map(
    documentTokens.map(({ id, counts }) => [
      id,
      tfidfVector(counts, inverseDocumentFrequency),
    ]),
  );
  return { documents, inverseDocumentFrequency, vectors };
}

function rankByVector(index: VectorIndex, query: string, limit: number): string[] {
  const queryVector = tfidfVector(
    tokenCounts(tokenize(query)),
    index.inverseDocumentFrequency,
  );
  return index.documents
    .map((document) => ({
      id: document.id,
      score: cosineSimilarity(queryVector, index.vectors.get(document.id) ?? new Map()),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((item) => item.id);
}

function graphCandidates(
  seedIds: string[],
  dataset: AgentMemoryBenchmarkDataset,
  limit: number,
): string[] {
  const seedRank = new Map(seedIds.map((id, index) => [id, index]));
  const candidates = new Map<string, number>();
  for (const edge of dataset.graphEdges) {
    const sourceRank = seedRank.get(edge.sourceId);
    const targetRank = seedRank.get(edge.targetId);
    if (sourceRank !== undefined && !seedRank.has(edge.targetId)) {
      candidates.set(edge.targetId, Math.min(candidates.get(edge.targetId) ?? Infinity, sourceRank));
    }
    if (targetRank !== undefined && !seedRank.has(edge.sourceId)) {
      candidates.set(edge.sourceId, Math.min(candidates.get(edge.sourceId) ?? Infinity, targetRank));
    }
  }
  return [...candidates]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

function evaluateEndToEnd(
  cases: AgentMemoryE2ECase[],
  queries: AgentMemoryRetrievalQuery[],
  evaluations: QueryEvaluation[],
): EndToEndMetrics {
  if (cases.length === 0) {
    return {
      case_count: 0,
      completion_rate: 0,
      evidence_coverage: 0,
      injected_tokens: { total: 0, mean: 0 },
    };
  }
  const queryById = new Map(queries.map((query) => [query.id, query]));
  const evaluationByQueryId = new Map(evaluations.map((evaluation) => [
    evaluation.queryId,
    evaluation,
  ]));
  let completed = 0;
  let evidenceFound = 0;
  let evidenceTotal = 0;
  let injectedTokens = 0;

  for (const testCase of cases) {
    const evaluation = evaluationByQueryId.get(testCase.queryId);
    if (!evaluation || !queryById.has(testCase.queryId)) {
      continue;
    }
    let used = 0;
    const injected = selectWithinTokenBudget(evaluation.ranked, testCase.tokenBudget);
    const selected = new Set(injected.map((document) => document.id));
    used = injected.reduce((sum, document) => sum + document.tokenEstimate, 0);
    injectedTokens += used;
    const found = testCase.requiredEvidenceIds.filter((id) => selected.has(id)).length;
    evidenceFound += found;
    evidenceTotal += testCase.requiredEvidenceIds.length;
    if (found === testCase.requiredEvidenceIds.length) {
      completed++;
    }
  }
  return {
    case_count: cases.length,
    completion_rate: completed / cases.length,
    evidence_coverage: evidenceTotal === 0 ? 0 : evidenceFound / evidenceTotal,
    injected_tokens: {
      total: injectedTokens,
      mean: injectedTokens / cases.length,
    },
  };
}

function recallAtK(
  ranked: RankedDocument[],
  relevant: Set<string>,
  k: number,
): number {
  if (relevant.size === 0) {
    return 0;
  }
  const found = ranked.slice(0, k).filter((item) => relevant.has(item.id)).length;
  return found / relevant.size;
}

function reciprocalRankFor(ranked: RankedDocument[], relevant: Set<string>): number {
  const index = ranked.findIndex((item) => relevant.has(item.id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function ndcgAtK(
  ranked: RankedDocument[],
  relevant: Set<string>,
  k: number,
): number {
  if (relevant.size === 0) {
    return 0;
  }
  let dcg = 0;
  ranked.slice(0, k).forEach((item, index) => {
    if (relevant.has(item.id)) {
      dcg += 1 / Math.log2(index + 2);
    }
  });
  let ideal = 0;
  for (let index = 0; index < Math.min(relevant.size, k); index++) {
    ideal += 1 / Math.log2(index + 2);
  }
  return ideal === 0 ? 0 : dcg / ideal;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function literalOccurrences(content: string, token: string): number {
  let count = 0;
  let fromIndex = 0;
  while (fromIndex < content.length) {
    const index = content.indexOf(token, fromIndex);
    if (index < 0) {
      break;
    }
    count++;
    fromIndex = index + token.length;
  }
  return count;
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function tfidfVector(
  counts: Map<string, number>,
  inverseDocumentFrequency: Map<string, number>,
): Map<string, number> {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return new Map();
  }
  return new Map(
    [...counts].flatMap(([token, count]) => {
      const idf = inverseDocumentFrequency.get(token);
      return idf === undefined ? [] : [[token, (count / total) * idf] as const];
    }),
  );
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) {
    normA += value * value;
  }
  for (const value of b.values()) {
    normB += value * value;
  }
  for (const [token, value] of a) {
    dot += value * (b.get(token) ?? 0);
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

function canonicalContent(content: string): string {
  return tokenize(content).join(' ');
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 3));
}

function selectWithinTokenBudget(
  ranked: RankedDocument[],
  tokenBudget: number,
): RankedDocument[] {
  const selected: RankedDocument[] = [];
  let used = 0;
  for (const document of ranked) {
    if (used + document.tokenEstimate > tokenBudget) {
      continue;
    }
    selected.push(document);
    used += document.tokenEstimate;
  }
  return selected;
}

function timedRank(run: () => string[]): { ids: string[]; latencyMs: number } {
  const started = performance.now();
  const ids = run();
  return { ids, latencyMs: performance.now() - started };
}

function minimumCheck(name: string, threshold: number, observed: number): GateCheck {
  return { name, threshold, observed, passed: observed >= threshold };
}

function maximumCheck(name: string, threshold: number, observed: number): GateCheck {
  return { name, threshold, observed, passed: observed <= threshold };
}

function emptyMetrics(): BaselineMetrics {
  return {
    query_count: 0,
    top_k: 0,
    recall_at_5: 0,
    recall_at_10: 0,
    mrr: 0,
    ndcg_at_10: 0,
    latency_ms: { p50: 0, p95: 0 },
    injected_tokens: { total: 0, mean: 0 },
    duplicate_rate: 0,
    max_session_concentration: 0,
  };
}

function hashDataset(dataset: AgentMemoryBenchmarkDataset): string {
  return createHash('sha256')
    .update(JSON.stringify(dataset))
    .digest('hex');
}

function hashIdList(ids: string[]): string {
  return createHash('sha256')
    .update([...ids].sort((a, b) => a.localeCompare(b)).join('\n'))
    .digest('hex');
}

function excludedQueryIds(dataset: AgentMemoryBenchmarkDataset): string[] {
  const eligible = new Set(dataset.queries.map((query) => query.id));
  return (dataset.taskCases ?? [])
    .filter((testCase) => testCase.abstention || !eligible.has(testCase.id))
    .map((testCase) => testCase.id);
}

function readGitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--fixture' && argv[index + 1]) {
      options.fixtureDir = argv[++index];
    } else if (arg === '--longmemeval-s' && argv[index + 1]) {
      options.longMemEvalSPath = argv[++index];
    } else if (arg === '--locomo' && argv[index + 1]) {
      options.loCoMoPath = argv[++index];
    } else if (arg === '--output' && argv[index + 1]) {
      options.outputPath = argv[++index];
    } else if (arg === '--seed' && argv[index + 1]) {
      const seed = Number.parseInt(argv[++index] ?? '', 10);
      if (!Number.isInteger(seed)) {
        throw new Error('--seed must be an integer');
      }
      options.seed = seed;
    } else if (arg === '--graph-rrf') {
      options.graphRrf = true;
    } else if (arg === '--production') {
      options.production = true;
    } else if (arg === '--scorecard-out' && argv[index + 1]) {
      options.scorecardOut = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const sources = [options.fixtureDir, options.longMemEvalSPath, options.loCoMoPath]
    .filter(Boolean).length;
  if (sources > 1) {
    throw new Error('--fixture, --longmemeval-s, and --locomo are mutually exclusive');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = options.production
    ? await runProductionAgentMemoryBenchmark(options)
    : runAgentMemoryBenchmark(options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    if (existsSync(outputPath) && readFileSync(outputPath, 'utf8') === json) {
      return;
    }
    writeFileSync(outputPath, json);
  } else {
    process.stdout.write(json);
  }
  if (options.scorecardOut && report.scorecard) {
    writeFileSync(resolve(options.scorecardOut), `${JSON.stringify(report.scorecard, null, 2)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? '')) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
