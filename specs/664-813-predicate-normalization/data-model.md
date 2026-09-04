# Data Model: #813 predicate normalization

No SQLite schema migration. Entities below are logical / metadata / CLI shapes.

## Canonical predicate

Dictionary standard form from `PredicateCanonicalizer` (e.g. `사용함`, `정의됨`,
`좋아함` — ㅁ nominalization). Prefer when `canonicalize.success === true`.

## Accepted OOV predicate

Not in dictionary; **single token** (no whitespace); Hangul-terminating;
`buildTripleSentence(s,p,o)` succeeds. Stored as trimmed original on semantic /
`kg_triple.predicate`.

## Phrase / rejected predicate

Whitespace, Latin-ending, empty, or reassembly-null → **not persisted**.
Emitted only as skip records.

## 형태 (2) semantic (existing pollution class)

`memory_item` semantic row whose `content` is truncated episodic source text
because `buildTripleSentence` failed at create time (`tripleToNaturalLanguage`
fallback). **New gated path must produce 0** of these (SC-001). Existing rows:
Non-Goal (no backfill).

## `kg_triple` (existing table — unchanged)

| Column | Gate use |
|--------|----------|
| subject / predicate / object | Only FR-001-accepted values upserted |
| UNIQUE(subject, predicate, object) | Unchanged |
| representative_memory_id | Unchanged |

No new columns, indexes, or migrations.

## Predicate skip record (in-memory / metadata)

```typescript
type PredicateSkipReason =
  | 'predicate_empty'
  | 'predicate_canonicalize_failed'
  | 'predicate_reassembly_failed';

interface PredicateSkip {
  index: number;
  predicate: string; // truncated for logs if needed; synthetic in tests
  reason: PredicateSkipReason;
}

interface NormalizeWithReportResult {
  triples: Triple[]; // accepted only
  skips: PredicateSkip[];
}
```

## `ExtractionInfo` extension (additive, internal)

```typescript
// Additive fields on ExtractionInfo (MCP contract unchanged)
predicateSkips?: PredicateSkip[];
predicateSkipCounts?: Partial<Record<PredicateSkipReason, number>>;
```

## `triple_extraction_metadata` success keys (additive)

Existing (`buildTripleExtractionSuccessMetadata`):
- `triple_count`, `extracted_at`, optional `confidence_avg`

Add for FR-007/FR-009:
- `predicate_skip_count: number`
- `predicate_skip_reasons: Partial<Record<PredicateSkipReason, number>>`

All-skipped soft success: `triple_count: 0` with non-zero skip counts; status
remains success (or equivalent primary-success commit) — not `failureReason: no_triple`.

## Quality report CLI shape (read-only)

```typescript
interface KgTriplePredicateQualityReport {
  total: number;
  hangul_termination_rate: number; // last char Hangul syllable
  whitespace_rate: number;         // predicate contains whitespace
  average_length: number;
  non_hangul_termination_count: number;
  samples: {
    non_hangul_termination: string[]; // predicates, capped (e.g. N=20)
    with_whitespace: string[];
  };
}
```

Stdout JSON: `{ ok: true, report }` — **omit** absolute `DB_PATH`. Tests assert
row counts unchanged after report.

## Synthetic fixtures only

Test DB seeds use invented s/p/o strings (e.g. `관련 작업`, `use`, `배포함`,
`사용함`). Never commit live IDs or user episodic text (FR-010).
