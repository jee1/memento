# Contract: Triple Extraction Batch Job

## Configuration

Public config fields and defaults remain unchanged:

| Field | Default | Validation |
|---|---:|---|
| `batchSize` | `10` | positive safe integer |
| `timeout` | `30000` ms | non-negative finite number |
| `maxRetries` | `3` | positive safe integer |
| `retryBackoffDays` | `[1,2,4]` | dense non-empty array of non-negative finite numbers |
| `chunkSize` | `5` | positive safe integer |
| `chunkDelayMs` | `100` ms | non-negative finite number |
| `parallelism` | `1` | exactly `1` |

Default applies only to omitted/`undefined`. Explicit NULL, boolean, numeric string, sparse array or invalid number is an
execution-policy error before schema ensure/service creation/target query.

## Candidate selection and retry

- Only active episodic rows with a consistent unprocessed or failed tuple are considered.
- Failed metadata must be a valid object with safe retry count, zoned UTC timestamp and finite stored backoff.
- Due instant is `last_attempt + next_retry_after_days * 24h`; equality is eligible.
- Eligibility precedes `batchSize`; order is `created_at ASC, id ASC`.
- The selected ID/source snapshot set is fixed for the execute and split into consecutive chunks.
- Immediately before extraction, source content/importance/status/scope/type/active fields are revalidated.
- Invalid legacy tuples/metadata are excluded with sanitized warning and never repaired automatically.

## Source outcomes

| Event | Outcome | Retry change |
|---|---|---|
| conversion commit success | `success` | none |
| stale or concurrent loser before extractor/commit | `skipped` | none |
| genuine pre-commit failure with durable failed state | `failed` | persisted count +1 |
| genuine failure reaching max with durable abandoned state | `failed` | persisted count +1, no next due |
| state-write failure or unconfirmed source | none | none |
| not started because of timeout/fatal error | none | none |

`maxRetries` includes the first automatic attempt. Backoff for new retry count `N` uses array position `N-1`, repeating the
last value after exhaustion.

## Timeout and fatal errors

Timeout checks occur before starting a source and before inter-chunk delay. A source started before deadline finishes commit
and settlement. `timeoutOccurred=true` only when deadline blocks a pending source/chunk; finishing the last source late does
not set it. Delay is capped by remaining timeout budget.

Source-isolatable failures continue to the next source. Chunk dispatch/aggregation/delay or job orchestration failures stop
the execute, preserve already durable prefix outcomes, set job `success=false`, and synthesize no outcomes for the rest.

## Result

The existing `TripleExtractionBatchResult` shape is retained. Every execute returns fresh Date, arrays and Map.

Required invariants:

```text
processed = details.processed
details.processed = details.success + details.failed + details.skipped
duration = endTime.getTime() - startTime.getTime()
```

Execution-level `success` remains true when at least one source terminal outcome exists and no job-level fatal occurred,
including all-failed/all-skipped and timeout after a processed prefix. It is false for zero processed sources or job-level
fatal.

`semanticMemoriesCreated/Updated` count durable primary outcome occurrences, not final unique rows. `retryCounts` includes
only current-execute durable failed/abandoned transitions and their persisted new counts. Errors/warnings are sanitized;
source content, raw triples, embeddings and raw LLM output are forbidden.

## Dependency lifetime

The extractor dependency may remain constructor-injected. An explicitly injected semantic service keeps the existing caller
DB-consistency responsibility. When not injected, create the semantic service inside each execute from that execute's DB and
do not cache it on the job instance. Overlapping executes must not share policy, clocks, candidates, result accumulators or
DB-bound services.

