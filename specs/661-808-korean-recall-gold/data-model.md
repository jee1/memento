# Data Model: 661-808-korean-recall-gold

**Storage**: JSON fixtures + gitignored `.local/` artifacts. No SQLite schema migration.

## Entities

### KoreanRecallGoldSet (committed)

| Field | Type | Rules |
|-------|------|-------|
| queries[].id | string | Opaque stable id (FR-026); unique; not equal to query text |
| queries[].query | string | Korean query text |
| queries[].relevantIds | string[] | Non-empty (FR-028); each id ∈ corpus |
| queries[].tags | string[] | Closed vocab; must include required coverage across set |
| corpus[].id | string | Synthetic fixture memory id (e.g. `ko_mem_*`); no live DB ids (FR-015) |
| corpus[].content | string | Synthetic; may include particle-agglutinated forms |
| manifest | object | `synthetic: true`, seed, top_k≥10, source_revision, license notes |

**Closed tags** (FR-021):
- `particle_agglutination` (required ≥1 query)
- `short_multi_concept` (required ≥1 query)
- `triple_isolation_probe` (optional; #804 reuse)

**Cardinality**: ≥15 queries (FR-012).

### PostFixProductionScorecard (artifact)

| Field | Source |
|-------|--------|
| recall_at_10, mrr | ProductionScorecard |
| ranking_version | scorecard + reproduction |
| embedding_provider | scorecard |
| dataset_sha256 / dataset_revision | scorecard |
| git_sha | `report.reproduction.git_sha` |
| measure_only | true for Korean arm (FR-019/024) |
| arm | `korean` \| `locomo_prod` (label) |

### BeforeAfterComparison (artifact / markdown)

| Field | Rules |
|-------|-------|
| condition_a / condition_b | e.g. quarantine before/after; #807 on/off |
| git_sha_a / git_sha_b | required for SC-004 |
| ranking_version_a / b | required |
| metrics | same schema (recall_at_10, mrr; optional by tag) |
| status | `complete` only if both sides present (FR-020) |

## Validation state machine (gold load)

```text
load → schema check → id resolve → category coverage
         │ fail           │ fail        │ fail
         ▼                ▼             ▼
      abort (no score)  skip query   abort if required cat → 0
```

Partial scorecard baseline: **forbidden** (FR-013/018).

## Relationships

- KoreanRecallGoldSet 1—* Query —* CorpusDoc (via relevantIds)
- KoreanBenchArm run → 1 Scorecard (+ reproduction)
- BeforeAfterComparison → 2 Scorecard snapshots
