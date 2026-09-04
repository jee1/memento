# Research: #813 predicate normalization gate

## Decision 1: Gate placement — `TripleNormalizer` (single choke point)

**Decision**: Enforce FR-001/FR-002 inside `TripleNormalizer.normalize` (or a
`normalizeWithReport` that `normalize` delegates to). Do **not** rely on
`tripleToNaturalLanguage` / `conjugatePredicate` changes.

**Rationale**: Live root cause is pass-through at
`triple-normalizer.ts` (`success ? canonical : triple.predicate`). Persist
(`createSemanticMemory` → `tripleToNaturalLanguage(..., source.content)`) only
materializes form-(2) **after** a bad predicate is already accepted. Filtering
upstream stops both semantic content and `kg_triple` upsert from the same list.

**Alternatives rejected**:
- Harden only `createSemanticMemory` (drop on `buildTripleSentence` null) —
  leaves `kg_triple` / scoring path able to see ungated predicates if any caller
  bypasses CRUD; also blurs #768 fallback semantics for non-extraction callers.
- Expand `conjugatePredicate` for English/phrases — Non-Goal; quality unverifiable.

**Second-look (scoring)**: `SemanticMemoryScoring.prepareNormalizedTriple` still
assigns `predicateResult.canonical` on `success: false` (trimmed original). After
the normalizer gate, only accepted predicates reach the pipeline, so this remains
confidence/linking logic — **no second gate required in v1**. Optional follow-up:
assert/log if unreassemblable predicate reaches create (defense-in-depth).

## Decision 2: Hangul OOV rule — reassembly alone is insufficient

**Decision**: OOV accept path requires **all** of:
1. `canonicalize` → `success: false`
2. trimmed predicate is a **single token** (no whitespace)
3. last character is Hangul (syllable)
4. `buildTripleSentence(subject, predicate, object)` returns non-null

**Rationale**: Phrase predicates like `관련 작업` **end in Hangul**, so
`conjugatePredicate` / `buildTripleSentence` can succeed and emit
`관련 작업합니다`. Spec Edge Cases / OQ-1 explicitly drop space-containing
phrases with **no head-word heuristic**. Reassembly-only would re-admit the
August surge class.

## Decision 3: Reason codes (fixed trio)

**Decision**: Skip reasons are exactly:
`predicate_empty` | `predicate_canonicalize_failed` | `predicate_reassembly_failed`

**Assignment**:
| Condition | Reason |
|-----------|--------|
| empty / whitespace-only after trim | `predicate_empty` |
| `canonicalize` success but `buildTripleSentence` null | `predicate_reassembly_failed` |
| Hangul single-token OOV but `buildTripleSentence` null | `predicate_reassembly_failed` |
| `canonicalize` fail and OOV rule not satisfied (phrase, Latin end, etc.) | `predicate_canonicalize_failed` |

**Rationale**: Spec FR-007 fixed set; maps cleanly to ops dashboards without
proliferating codes. Partial success aggregates counts by reason in
`triple_extraction_metadata` / structured logs.

## Decision 4: Normalizer API shape

**Decision**: Prefer `normalizeWithReport(triples) → { triples, skips }` where
`skips: Array<{ index: number; predicate: string; reason: PredicateSkipReason }>`.
Keep `normalize(triples): Triple[]` as thin wrapper returning `.triples` for
backward callers, **or** update `ITripleNormalizer` once and fix call sites
(`TripleExtractionService` is the primary consumer).

**Rationale**: Need structured skips for FR-007/FR-009 without a hidden
mutable “lastSkips” field. Extraction service folds skips into
`ExtractionInfo` (extend with optional `predicateSkips` / counts) then into
source metadata via `buildTripleExtractionSuccessMetadata` (extend keys:
`predicate_skip_count`, `predicate_skip_reasons`).

## Decision 5: Empty-after-gate vs LLM empty (`convertEpisodicSource`)

**Decision**: Distinguish:
- **LLM / parse empty** (`no_triple`, parse fail) → existing failure path
- **Gate filtered all** (LLM returned ≥1 triple, all skipped) → **soft success**:
  do not call `buildFailureOutcome`; commit primary success (or success with
  `triple_count: 0` + skip aggregates) per FR-009 / OQ-7

**Rationale**: Today `convertEpisodicSource` treats `triples.length === 0` as
failure. After the gate, that branch would incorrectly hard-fail episodic
extraction when every predicate is phrase/Latin — violating partial-success and
remember non-interruption.

## Decision 6: Quality CLI pattern

**Decision**: Read-only npm script mirroring `db:residue` / `memory:repair-triple-sentences`:
- Script: `scripts/kg-triple-predicate-quality.ts` (+ pure report builder under
  `scripts/lib/` or colocated export)
- npm: `memory:kg-triple-predicate-quality`
- Output: JSON aggregates + capped samples; **no** absolute DB path in stdout;
  **no** unbounded ID dump
- Fixtures: synthetic `kg_triple` rows in Vitest only (FR-010)

**Metrics** (FR-005): hangul termination rate, whitespace rate, average length,
non-hangul-termination count (= reassembly-impossible proxy), capped samples.

**Alternatives rejected**: Admin HTTP telemetry (OQ-3 follow-up); live DB in CI.

## Decision 7: No schema / MCP / backfill

**Decision**: Confirm Non-Goals — no `kg_triple` migration, no MCP tool schema
change, no bulk rewrite of existing form-(2) rows (#804/#811 adjacent later).

## Code map (inspected)

| Path | Role |
|------|------|
| `triple-normalizer.ts` | **Bug**: pass-through on canonicalize fail |
| `predicate-canonicalizer.ts` | Dictionary; `success: false` returns trimmed original |
| `triple-sentence.ts` | `buildTripleSentence` / Hangul conjugate; null on non-Hangul end |
| `semantic-memory-scoring.ts` | `tripleToNaturalLanguage` form-(2) fallback; scoring canonicalize |
| `semantic-memory-crud.ts` | Creates semantic + `kgTripleRepo.upsertTriple` |
| `semantic-memory-update-pipeline.ts` | Persist loop from extraction triples |
| `episodic-semantic-conversion.ts` | `convertEpisodicSource` (#805); empty-triple failure today |
| `triple-extraction-metadata.ts` | Success metadata keys to extend |
| `scripts/repair-triple-sentence-memories.ts`, `db-residue-cleanup.ts` | CLI style templates |
