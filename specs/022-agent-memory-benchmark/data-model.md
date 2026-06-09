# Data Model: Agent Memory Benchmark

## BenchmarkManifest

| Field | Type | Rule |
| --- | --- | --- |
| benchmark_version | string | immutable fixture contract version |
| name | string | report identifier |
| license | string | SPDX-compatible value |
| redistribution | string | `allowed` required |
| license_reviewed | boolean | true required |
| secret_reviewed | boolean | true required |
| synthetic | boolean | true for committed corpus |
| source_revision | string | source/version note |
| seed | integer | deterministic default |
| top_k | integer | >= 10 |
| token_budget | integer | E2E/shared injection budget |
| gates | object | quality/latency/duplicate/session thresholds |

## AgentMemoryDocument

```ts
interface AgentMemoryDocument {
  id: string;
  sessionId: string;
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  createdAt: string;
  provenanceObservationIds: string[];
}
```

IDs are unique. Content must pass secret scanning.

## RetrievalQuery

```ts
interface RetrievalQuery {
  id: string;
  query: string;
  relevantIds: string[];
  targetSessionIds: string[];
}
```

Every relevant ID and target session must exist.

## GraphEdge

```ts
interface GraphEdge {
  sourceId: string;
  targetId: string;
  type: 'derived_from' | 'same_incident' | 'supports' | 'supersedes';
}
```

Both endpoints must exist. Evaluation treats edges as undirected candidate expansion while preserving the stored type.

## E2ECase

```ts
interface E2ECase {
  id: string;
  queryId: string;
  requiredEvidenceIds: string[];
  tokenBudget: number;
}
```

Completion is true only when every required evidence ID is selected within the case token budget.

## BaselineMetrics

```ts
interface BaselineMetrics {
  queryCount: number;
  topK: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  latencyMs: { p50: number; p95: number };
  injectedTokens: { total: number; mean: number };
  duplicateRate: number;
  maxSessionConcentration: number;
}
```

## Report

```ts
interface AgentMemoryBenchmarkReport {
  schemaVersion: 1;
  reproduction: ReproductionManifest;
  retrieval: Record<BaselineName, BaselineMetrics>;
  endToEnd: Record<BaselineName, EndToEndMetrics>;
  gates: GateReport;
}
```

`retrieval` and `endToEnd` cannot be merged into a composite score.

## LongMemEval-S Input Contract

Each JSONL record:

```ts
interface LongMemEvalSRecord {
  question_id: string;
  question: string;
  haystack_sessions: Array<{
    session_id: string;
    memories: Array<{ memory_id: string; content: string; timestamp?: string }>;
  }>;
  answer_session_ids: string[];
  answer_memory_ids: string[];
}
```

The adapter emits one document per memory and one retrieval query per record. Duplicate memory IDs with different content are invalid.
