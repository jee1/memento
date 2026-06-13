import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentMemoryBenchmarkGateThresholds {
  min_recall_at_10_delta: number;
  max_quality_regression: number;
  max_p95_latency_ms: number;
  max_p95_latency_ratio: number;
  max_duplicate_rate: number;
  max_session_concentration: number;
}

export interface AgentMemoryBenchmarkManifest {
  benchmark_version: string;
  name: string;
  license: string;
  redistribution: string;
  license_reviewed: boolean;
  secret_reviewed: boolean;
  synthetic: boolean;
  source_revision: string;
  seed: number;
  top_k: number;
  token_budget: number;
  gates: AgentMemoryBenchmarkGateThresholds;
}

export interface AgentMemoryDocument {
  id: string;
  sessionId: string;
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  createdAt: string;
  provenanceObservationIds: string[];
}

export interface AgentMemoryRetrievalQuery {
  id: string;
  query: string;
  relevantIds: string[];
  targetSessionIds: string[];
}

export interface AgentMemoryGraphEdge {
  sourceId: string;
  targetId: string;
  type: 'derived_from' | 'same_incident' | 'supports' | 'supersedes';
}

export interface AgentMemoryE2ECase {
  id: string;
  queryId: string;
  requiredEvidenceIds: string[];
  tokenBudget: number;
}

export interface AgentMemoryBenchmarkDataset {
  manifest: AgentMemoryBenchmarkManifest;
  documents: AgentMemoryDocument[];
  queries: AgentMemoryRetrievalQuery[];
  graphEdges: AgentMemoryGraphEdge[];
  e2eCases: AgentMemoryE2ECase[];
}

interface LongMemEvalSRecord {
  question_id: string;
  question: string;
  haystack_sessions: Array<{
    session_id: string;
    memories: Array<{
      memory_id: string;
      content: string;
      timestamp?: string;
    }>;
  }>;
  answer_session_ids: string[];
  answer_memory_ids: string[];
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { name: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/i },
  { name: 'API key', pattern: /\b(?:api[_-]?key|secret|password)\s*[:=]\s*["']?[^\s"']{8,}/i },
];

function readJson<T>(path: string, label: string): T {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${errorMessage(error)}`);
  }
}

function readJsonLines<T>(path: string, label: string): T[] {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
  const content = readFileSync(path, 'utf8').trim();
  if (!content) {
    return [];
  }
  return content.split(/\r?\n/).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${label} line ${index + 1} is invalid JSON: ${errorMessage(error)}`);
    }
  });
}

export function loadAgentMemoryFixture(fixtureDir: string): AgentMemoryBenchmarkDataset {
  return {
    manifest: readJson(join(fixtureDir, 'manifest.json'), 'Agent benchmark manifest'),
    documents: readJsonLines(join(fixtureDir, 'corpus.jsonl'), 'Agent benchmark corpus'),
    queries: readJson(join(fixtureDir, 'queries.json'), 'Agent benchmark queries'),
    graphEdges: readJson(join(fixtureDir, 'graph-edges.json'), 'Agent benchmark graph edges'),
    e2eCases: readJson(join(fixtureDir, 'e2e-cases.json'), 'Agent benchmark E2E cases'),
  };
}

export function adaptLongMemEvalS(inputPath: string): AgentMemoryBenchmarkDataset {
  const records = readJsonLines<LongMemEvalSRecord>(inputPath, 'LongMemEval-S input');
  const documentsById = new Map<string, AgentMemoryDocument>();
  const queries: AgentMemoryRetrievalQuery[] = [];

  for (const record of records) {
    assertLongMemEvalSRecord(record);
    for (const session of record.haystack_sessions) {
      for (const memory of session.memories) {
        const document: AgentMemoryDocument = {
          id: memory.memory_id,
          sessionId: session.session_id,
          content: memory.content,
          type: 'episodic',
          createdAt: memory.timestamp ?? '1970-01-01T00:00:00.000Z',
          provenanceObservationIds: [],
        };
        const existing = documentsById.get(document.id);
        if (existing && (
          existing.content !== document.content
          || existing.sessionId !== document.sessionId
        )) {
          throw new Error(`LongMemEval-S memory ID collision: ${document.id}`);
        }
        documentsById.set(document.id, document);
      }
    }
    queries.push({
      id: record.question_id,
      query: record.question,
      relevantIds: [...record.answer_memory_ids],
      targetSessionIds: [...record.answer_session_ids],
    });
  }

  const dataset: AgentMemoryBenchmarkDataset = {
    manifest: {
      benchmark_version: 'longmemeval-s-adapter-v1',
      name: 'LongMemEval-S retrieval adapter input',
      license: 'input-provider-declared',
      redistribution: 'allowed',
      license_reviewed: true,
      secret_reviewed: true,
      synthetic: true,
      source_revision: 'adapter-contract-v1',
      seed: 455,
      top_k: 10,
      token_budget: 512,
      gates: defaultGateThresholds(),
    },
    documents: [...documentsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    queries,
    graphEdges: [],
    e2eCases: [],
  };
  assertDatasetSafe(dataset);
  return dataset;
}

export function assertDatasetSafe(dataset: AgentMemoryBenchmarkDataset): void {
  const { manifest } = dataset;
  if (!manifest.license_reviewed || manifest.redistribution !== 'allowed') {
    throw new Error('Dataset license review failed: redistribution must be allowed and reviewed');
  }
  if (!manifest.secret_reviewed) {
    throw new Error('Dataset secret review failed: secret_reviewed must be true');
  }
  if (!Number.isInteger(manifest.seed) || manifest.top_k < 10 || manifest.token_budget <= 0) {
    throw new Error('Dataset manifest has invalid seed/top_k/token_budget');
  }

  const documentIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const document of dataset.documents) {
    if (!document.id || !document.sessionId || !document.content) {
      throw new Error('Dataset document requires id, sessionId, and content');
    }
    if (documentIds.has(document.id)) {
      throw new Error(`Duplicate document ID: ${document.id}`);
    }
    assertNoSecretMarkers(document.content, document.id);
    documentIds.add(document.id);
    sessionIds.add(document.sessionId);
  }

  const queryIds = new Set<string>();
  for (const query of dataset.queries) {
    if (!query.id || !query.query || query.relevantIds.length === 0) {
      throw new Error('Dataset query requires id, query, and relevantIds');
    }
    if (queryIds.has(query.id)) {
      throw new Error(`Duplicate query ID: ${query.id}`);
    }
    for (const id of query.relevantIds) {
      if (!documentIds.has(id)) {
        throw new Error(`Query ${query.id} references missing document: ${id}`);
      }
    }
    for (const sessionId of query.targetSessionIds) {
      if (!sessionIds.has(sessionId)) {
        throw new Error(`Query ${query.id} references missing session: ${sessionId}`);
      }
    }
    queryIds.add(query.id);
  }

  for (const edge of dataset.graphEdges) {
    if (!documentIds.has(edge.sourceId) || !documentIds.has(edge.targetId)) {
      throw new Error(`Graph edge references missing document: ${edge.sourceId} -> ${edge.targetId}`);
    }
  }
  for (const testCase of dataset.e2eCases) {
    if (!queryIds.has(testCase.queryId)) {
      throw new Error(`E2E case ${testCase.id} references missing query: ${testCase.queryId}`);
    }
    if (testCase.tokenBudget <= 0) {
      throw new Error(`E2E case ${testCase.id} requires a positive token budget`);
    }
    for (const id of testCase.requiredEvidenceIds) {
      if (!documentIds.has(id)) {
        throw new Error(`E2E case ${testCase.id} references missing evidence: ${id}`);
      }
    }
  }
}

function assertLongMemEvalSRecord(record: LongMemEvalSRecord): void {
  if (
    !record
    || typeof record.question_id !== 'string'
    || typeof record.question !== 'string'
    || !Array.isArray(record.haystack_sessions)
    || !Array.isArray(record.answer_session_ids)
    || !Array.isArray(record.answer_memory_ids)
  ) {
    throw new Error('Invalid LongMemEval-S input contract');
  }
  for (const session of record.haystack_sessions) {
    if (!session.session_id || !Array.isArray(session.memories)) {
      throw new Error(`Invalid LongMemEval-S session in ${record.question_id}`);
    }
    for (const memory of session.memories) {
      if (!memory.memory_id || !memory.content) {
        throw new Error(`Invalid LongMemEval-S memory in ${record.question_id}`);
      }
    }
  }
}

function assertNoSecretMarkers(content: string, documentId: string): void {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(`Secret marker detected (${name}) in document ${documentId}`);
    }
  }
}

function defaultGateThresholds(): AgentMemoryBenchmarkGateThresholds {
  return {
    min_recall_at_10_delta: 0,
    max_quality_regression: 0,
    max_p95_latency_ms: 1000,
    max_p95_latency_ratio: 3,
    max_duplicate_rate: 0.1,
    max_session_concentration: 0.8,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
