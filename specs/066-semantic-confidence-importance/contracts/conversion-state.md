# Contract: Episodic-to-Semantic Conversion State

## Consumers

The same internal conversion coordinator is used by remember background augmentation,
`ConvertEpisodicToSemanticTool`, and `TripleExtractionBatchJob`. Existing MCP/tool result fields remain unchanged. The
coordinator is not exported from the package root.

## Processing boundary

1. Read and value-copy the active episodic source snapshot.
2. Run extractor and semantic preparation outside a write transaction.
3. Revalidate the source snapshot at commit.
4. Atomically commit all semantic/KG primary mutations and the source success tuple.
5. Settle relation, embedding and observation intents before returning, independently of one another.

No external provider call or awaited observation runs inside the write transaction.

## Single-winner behavior

Normal automatic conversion commits only if the source still has the eligible conversion tuple and the same content,
importance, scope, type and active state. Conditional writes/row validation determine the winner. A losing/stale attempt
rolls back without source failure/retry transition. No global mutex, lease or idempotency table is introduced.

Forced reprocessing (`skipConverted=false`) is a new evidence occurrence when it succeeds. If it fails before commit, the
existing success flag/status/metadata remain unchanged.

## Success classification

- One or more committed primary outcomes: success.
- Zero primary outcomes and only policy exclusions: success.
- Actual empty extraction at service boundary: no-op; at automatic conversion boundary it follows the existing no-triple
  failure/retry policy.
- Zero primary outcomes with malformed input, normalization, confidence or candidate operational failure: genuine
  pre-commit failure.

Success metadata does not re-query historical relations. `triple_count` preserves the original input-position count;
`confidence_avg` is the arithmetic mean of only the current call's committed coalesced primary occurrences and is omitted
when no primary confidence exists.

## Failure classification

Genuine pre-commit failure may conditionally write failed or abandoned metadata. If that failure-state transaction itself
fails, source state remains unchanged and no uncommitted retry count is reported. Post-commit relation/embedding/statistics
failure never creates a retry.

Only existing `TripleExtractionFailureReason` values are persisted. Malformed extractor runtime results normalize to
`llm_parse_fail`; a valid empty result uses a valid supplied reason or `no_triple`.

## Post-commit intents

For each committed semantic occurrence, attempt:

1. `semantic --extracted_from--> episodic`;
2. `episodic --supported_by--> semantic`;
3. semantic embedding creation where needed.

Both relation directions are independent. An existing identical relation is successful no-op with no confidence/metadata
rewrite. All intents are settled before normal return; their completion order is unspecified.
