# Contract: Semantic Memory Update

## Compatibility surface

기존 호출 모양을 유지한다.

```ts
updateSemanticMemory(
  extractionResult: TripleExtractionResult,
  options: {
    episodicMemoryId: string;
    episodicImportance?: number;
    confidenceThreshold?: number;
    similarityThreshold?: number;
  }
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  semanticMemoryIds: string[];
}>
```

공개 결과에 `duplicate`, confidence samples, warnings를 추가하지 않는다. Duplicate는 기존 statistics 내부 분류로
남고 public `skipped`에 합산하지 않는다.

## Request validation

1. `triples=[]`인 실제 빈 배열은 DB 조회/상태 변경 없는 기존 no-op이다.
2. non-empty request는 result object, triples array, extractionInfo object, required step booleans를 검증한다.
3. 각 위치는 non-null non-array object이고 SPO는 string/non-empty-after-normalize여야 한다.
4. episodic ID는 비공백 string, provided importance/threshold는 finite `[0,1]`이다.
5. shared request validation failure는 첫 DB write 전에 reject한다. Triple-local malformed/normalization failure는 해당
   위치만 skipped한다.

## Quality and persistence

- Confidence weights/algorithms are unchanged.
- Store only when `confidence > confidenceThreshold`.
- New/exact/similar paths persist non-NULL confidence and the same importance formula.
- Merge increments `num_times` exactly once per coalesced evidence occurrence and never changes `recall_count`.
- Aggregate uses accepted evidence count; NULL legacy confidence initializes from new evidence.
- Latest committed occurrence supplies episodic importance.
- Explicit episodic importance `0` never becomes default `0.5` or positive through boost.
- Once aggregate is below `1`, numerical rounding cannot restore boost eligibility.

## Candidate eligibility

Candidate must be active semantic, null-safe same owner/project, automatic provenance, structurally valid and have valid
aggregate fields. Legacy provenance with empty `origin_source` is eligible only with an existing `extracted_from` relation.
The query must prefilter scope/provenance before reading content or embeddings.

Exact structural match precedes similar. Similar comparison accepts `score >= similarityThreshold`. Invalid/unavailable
required evidence is an operational skip, not a create decision.

## Determinism and result reconciliation

- Normalize once per input position.
- Coalesce by normalized SPO, then by resolved semantic target.
- Highest confidence represents a group; target order is first input index.
- `semanticMemoryIds` contains only committed created/updated IDs, unique and ordered.
- Caller mutation of input options/triples after invocation start cannot alter the current request.

## Failure and privacy

Relation direction/type contract failure is pre-primary and propagates. Candidate or DB operational failure rolls back the
affected conversion unit. After commit, relation, embedding or statistics failure is logged without changing result/source
success.

Logs/errors may include source ID, input index and normalized reason code. They must not contain raw SPO, source content,
embedding vector or raw LLM output.

