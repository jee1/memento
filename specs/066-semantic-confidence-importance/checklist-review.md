# Code Review — specs/066-semantic-confidence-importance (round 1)

**Reviewer scope**: `.superpowers/sdd/066-semantic-confidence-importance/review-package-r1.diff.txt`, spec.md, plan.md,
contracts/{conversion-state,batch-job,semantic-update}.md, constitution.md v1.2.0, and current-worktree production
files (episodic-semantic-conversion.ts, convert-episodic-to-semantic-tool.ts, remember-tool-augmentation.ts,
triple-extraction-batch-job.ts + submodules, semantic-memory-{scoring,similarity,crud,relations,update-pipeline,
update-service,statistics}.ts).

## Process note (not a code defect)

`packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts` and its spec are **new,
untracked files** (`git status` shows `??`), so `review-package-r1.diff.txt` (produced via `git diff`) does not
contain them even though the plan calls this file the shared conversion coordinator used by all three automatic
entrypoints. This review read the file directly from the current worktree per the task's "key production files"
instruction, but a future diff package for this feature should include untracked new files (e.g. `git diff
--no-index` or `git add -N` before diffing) so reviewers don't have to cross-check `git status` to discover missing
coverage.

## Summary

The refactor (scoring/crud/similarity/relations/pipeline split + shared `convertEpisodicSource` coordinator) is
well-tested (445/445 relevant Vitest specs pass) and the core quality formula, strict `>` threshold, CAS-based
single-winner commits, and privacy-safe logging all match the spec/contracts closely. Two gaps were found with
confidence ≥ 80: an outcome-misclassification edge case in the new coordinator's failure path, and orphaned/duplicated
helper code left behind by the batch-job refactor. Neither blocks merge on its own, but both should be fixed before
sign-off since one is a direct, testable contract violation (FR-084) and the other represents unfinished cleanup that
the plan explicitly promised ("하나의 신규 파일만 추가해 세 곳의 중복 상태 로직을 제거").

**Merge opinion**: Conditional approval — fix Important-1 (and ideally Important-2) before merge; both are small,
localized diffs.

---

## Important

### I-1: Stale-source race in the no-triple failure path is misclassified as `failed` instead of `skipped`

- **Confidence**: 82
- **Location**: `packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts:254-256` (call
  site) and `:217-219` (the check inside `buildFailureOutcome`)
- **Contract/FR violated**: `contracts/conversion-state.md` §Single-winner behavior and
  `contracts/batch-job.md` §Source outcomes ("stale or concurrent loser before extractor/commit → `skipped`, no
  retry change" / "state-write failure or unconfirmed source → none, none"); `spec.md` FR-084 ("하나라도 달라졌거나
  원본이 사라지면 ... 해당 호출은 기존 **skipped** outcome으로 한 번 정산").

**Description**: `convertEpisodicSource` has two call sites for `buildFailureOutcome`. The
`updateSemanticMemoryWithEvidence` catch block (lines 265-273) correctly pre-checks
`!sourceStillMatches(db, snapshot)` and returns `{ kind: 'skipped' }` *before* calling `buildFailureOutcome` when the
source changed. The **no-triple branch** (lines 254-256) skips this pre-check and calls `buildFailureOutcome`
directly:

```238:257:packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts
  const extractionResult = await safeExtract(tripleExtractionService, snapshot.content, options.sourceId);

  if (extractionResult.triples.length === 0) {
    const failureReason = normalizeFailureReason(extractionResult.extractionInfo.failureReason);
    return buildFailureOutcome(db, snapshot, options, failureReason);
  }
```

Inside `buildFailureOutcome`, the `!sourceStillMatches(db, snapshot)` branch returns `{ kind: 'failed' }` **without**
attempting `commitTuple` and **without** a `retryCount`:

```204:236:packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts
function buildFailureOutcome(...): EpisodicSemanticConversionOutcome {
  if (snapshot.tripleExtractedStatus === 'success') {
    return { kind: 'failed' };
  }
  if (!sourceStillMatches(db, snapshot)) {
    return { kind: 'failed' };
  }
  ...
```

If the episodic source's `content`/`importance`/`owner_id`/`project_id` changes between the initial snapshot read and
the no-triple check (plausible in the `remember` background-augmentation path, where LLM extraction can take
seconds while the same memory could be edited/consolidated concurrently), this path returns `{ kind: 'failed' }` with
`retryCount === undefined` — no DB write occurs at all.

`triple-extraction-batch-job.ts` treats any `outcome.kind === 'failed'` as a processed failure regardless of whether
`retryCount` is defined:

```163:174:packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job.ts
if (outcome.kind === 'success') {
  ...
} else if (outcome.kind === 'failed') {
  result.details.failed++;
  if (outcome.retryCount !== undefined) {
    result.details.retryCounts.set(source.id, outcome.retryCount);
  }
} else {
  result.details.skipped++;
}
```

This increments `result.details.failed` (and therefore `processed`, via `reconcileResult`) for a source that never
had any durable state change — contradicting FR-084's explicit requirement that this settle as `skipped`, and the
batch-job contract's "unconfirmed source → none, none" row. `episodic-semantic-conversion.spec.ts`'s "stale source
skipped" describe block (lines 376-460) only exercises staleness caused by the semantic-update mock mutating the row
mid-call — it does not cover a stale source reached via the no-triple branch, so this gap is untested.

**Fix recommendation**: In the no-triple branch (and ideally inside `buildFailureOutcome` itself, for both callers),
check `sourceStillMatches` first and return `{ kind: 'skipped' }` when it fails, mirroring the existing catch-block
pattern:

```ts
if (extractionResult.triples.length === 0) {
  if (!sourceStillMatches(db, snapshot)) {
    return { kind: 'skipped' };
  }
  const failureReason = normalizeFailureReason(extractionResult.extractionInfo.failureReason);
  return buildFailureOutcome(db, snapshot, options, failureReason);
}
```
Add a regression test that mutates the source's content via the `tripleExtractionService.extractTriples` mock before
resolving `{ triples: [] }`, asserting `{ kind: 'skipped' }` and no metadata write.

---

### I-2: Orphaned/duplicated helper code left behind by the batch-job refactor

- **Confidence**: 88
- **Location**:
  - `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job-retry.ts:15-119`
    (`getTripleExtractionTargetMemories`, `shouldRetryTripleExtraction`, `getTripleExtractionRetryCount`)
  - `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job-memory-status.ts:9-124`
    (`buildTripleExtractionSuccessMetadata`, `buildTripleExtractionFailedMetadata`,
    `buildTripleExtractionAbandonedMetadata`, `updateTripleExtractionMemoryStatus`,
    `calculateTripleExtractionAverageConfidence`)

**Description**: `triple-extraction-batch-job.ts` was rewritten to delegate per-source state transitions to the new
shared coordinator `convertEpisodicSource`, and `processTripleExtractionChunk` was correctly deleted from
`triple-extraction-batch-job-chunk.ts` (confirmed via `git diff` — the whole function and its imports of
`getTripleExtractionRetryCount`/`shouldRetryTripleExtraction`/`updateTripleExtractionMemoryStatus`/
`calculateTripleExtractionAverageConfidence` were removed). However, the now-callerless exports in
`triple-extraction-batch-job-retry.ts` (`getTripleExtractionTargetMemories`, `shouldRetryTripleExtraction`,
`getTripleExtractionRetryCount`) were left in place. A repo-wide search confirms zero references outside their own
file.

Worse, `triple-extraction-batch-job-memory-status.ts` had **three new functions added by this same PR**
(`buildTripleExtractionSuccessMetadata`/`buildTripleExtractionFailedMetadata`/`buildTripleExtractionAbandonedMetadata`
— confirmed via `git diff`, they don't exist on the base branch) that are exercised only by their own new spec file
and never called from any production code path. `episodic-semantic-conversion.ts`'s `commitTuple`/`buildFailureOutcome`
independently re-literal the exact same metadata shapes (`{ triple_count, extracted_at }`,
`{ failureReason, retry_count, last_attempt, next_retry_after_days }`,
`{ failureReason, retry_count, last_attempt, abandoned_at }`) inline instead of reusing these new helpers — i.e. the
PR wrote the shared builder twice and wired up neither copy to the other.

This contradicts the plan's own stated goal ("하나의 신규 파일만 추가해 세 곳의 중복 상태 로직을 제거") and the
workspace's "ponytail" simplicity/reuse principle (existing helper in the codebase should be reused, not
re-implemented; unused code introduced by your own change should be cleaned up).

**Fix recommendation**: Either (a) delete the now-unused exports (`getTripleExtractionTargetMemories`,
`shouldRetryTripleExtraction`, `getTripleExtractionRetryCount`, `updateTripleExtractionMemoryStatus`,
`calculateTripleExtractionAverageConfidence`) and their dedicated spec coverage, keeping only the new
`buildTripleExtraction*Metadata` builders if `episodic-semantic-conversion.ts` is updated to call them instead of
inlining equivalent object literals; or (b) if the metadata-shape builders are worth keeping as a documented contract,
wire `commitTuple`/`buildFailureOutcome` to call them so there is exactly one source of truth for each metadata shape.

---

## Suggestion

None reaching confidence ≥ 80 beyond what's folded into I-2.

---

## Areas reviewed and found compliant

- **Quality formula** (`semantic-memory-scoring.ts`): strict `confidence > threshold`; NULL-confidence
  initialization to the new evidence value; the `aggregate === 1 && (existing < 1 || next < 1)` epsilon guard
  correctly prevents floating-point rounding from resurrecting boost eligibility (FR-037); boost gated on
  `aggregateConfidence === 1 && base > 0 && finalNumTimes > 1` (FR-006/007/008); explicit importance `0` stays `0`
  through the whole pipeline (FR-009/SC-014).
- **CAS-based single-winner commits** (`episodic-semantic-conversion.ts`, `semantic-memory-crud.ts`): both the
  source-tuple commit and the semantic aggregate update use conditional `WHERE ... IS ?` clauses against the full
  prior snapshot, giving atomic single-winner semantics without a mutex/lease, matching
  `contracts/conversion-state.md`.
- **Candidate eligibility filters** (`semantic-memory-similarity.ts`, `semantic-memory-crud.ts`): scope/provenance/
  structural-validity prefilter runs before any embedding/content access (FR-041/044); legacy `origin_source`-empty
  rows require an existing `extracted_from` relation (FR-028); KG-representative mismatch excludes stale rows
  (FR-035).
- **Privacy in logs**: every `logger.*` call touched by this diff logs IDs, confidence/importance numbers, and
  normalized reason codes only — no raw subject/predicate/object/content/embedding appears in any log statement
  reviewed (FR-045, contracts/semantic-update.md §Failure and privacy).
- **Batch timeout/fatal semantics** (`triple-extraction-batch-job.ts`): timeout checked before starting a source and
  before the inter-chunk delay only; delay capped by remaining budget; job-level fatal errors preserve the durable
  prefix and set `success=false`; verified against `triple-extraction-batch-job-contract.spec.ts`'s dedicated cases.
- **Test suite**: all 445 Vitest specs across the touched semantic/remember/scheduler domains pass; graphify report
  (`graphify-out/GRAPH_REPORT.md`) is freshly rebuilt (timestamp within the last 15 minutes of review).


## Fix round R1 (2026-08-30)

- **I-1 ADDRESSED**: `buildFailureOutcome` returns `skipped` for stale source and failed failure-state CAS (no durable write).
- **I-2 ADDRESSED**: Canonical metadata builders live in `domains/memory/semantic/triple-extraction-metadata.ts`; coordinator reuses them; dead legacy batch helpers removed; `memory-status.ts` re-exports builders.

## Re-review R2 (2026-08-30)

**Verdict: CLEAN** — 0 critical / 0 important / 0 suggestion.

- **I-1 confirmed ADDRESSED**: `!sourceStillMatches` and failed-`commitTuple` checks live inside `buildFailureOutcome`
  itself, so all three call sites into it (no-triple branch, evidence-catch branch, `committedCount===0 && hasError`
  branch) are protected uniformly — stronger than the per-call-site patch R1 suggested. Regression test
  `episodic-semantic-conversion.spec.ts:475-497` exercises the exact race.
- **I-2 confirmed ADDRESSED**: repo-wide grep for the five legacy helpers (`getTripleExtractionTargetMemories`,
  `shouldRetryTripleExtraction`, `getTripleExtractionRetryCount`, `updateTripleExtractionMemoryStatus`,
  `calculateTripleExtractionAverageConfidence`) returns zero matches under `packages/`;
  `triple-extraction-batch-job-memory-status.ts` is now a re-export shim over the canonical builders.
- Verification: `episodic-semantic-conversion.spec.ts` + `triple-extraction-batch-job-{contract,,retry}.spec.ts`
  (144/144 pass); `tsc -p packages/memento-core/tsconfig.json --noEmit` clean.
- No new Critical/Important regressions found in the fix files.
