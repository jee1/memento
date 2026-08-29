# Data Model: FTS OR + prefix* (#807)

**Feature**: `specs/660-807-fts-or-prefix`  
**Date**: 2026-08-29  
**Persistence**: No new tables or migrations on the default path. Operates on existing FTS5 virtual table `memory_item_fts` and in-process query strings.

## Entities (logical)

### ContentWord

A token remaining after `preprocessQuery`.

| Field | Rule |
|-------|------|
| `value` | `[a-zA-Z0-9가-힣]+` after strip/stopword filter |
| `length` | JS string length |
| `prefixEligible` | `length >= FTS_MIN_PREFIX_STEM_LENGTH` (2) |

### FtsQueryTerm

Emitted MATCH term.

| Field | Rule |
|-------|------|
| `term` | `value` or `value + '*'` if prefixEligible |
| `combiner` | Always `OR` between terms when ≥2 terms (short and long) |
| `cap` | At most `FTS_MAX_TOKENS_FOR_OR` (8) terms on the long path; short path has ≤5 tokens by classification so cap is non-binding |

### FtsQueryString

Final string passed to FTS5 `MATCH`.

| State | Value |
|-------|--------|
| No content words after preprocess | `""` (existing empty / match-all sentinel — **unchanged policy**) |
| ≥1 content word | `term1 OR term2 OR …` after `makeFTSSafe` |

### TextCandidateSet

Pre-fusion memory IDs from the text channel.

| Constraint | Source |
|------------|--------|
| Count may increase vs pre-fix | FR-001/FR-002 |
| Must respect existing LIMIT / candidate caps | FR-017 |
| Filters (type/tag/owner/…) still apply | FR-011 / Edge Cases |

### AblationRecord

Non-persisted documentation entity (markdown table).

| Field | Description |
|-------|-------------|
| `variant` | current AND / OR-only / OR+prefix / trigram-compare |
| `text_candidate_metrics` | counts / zero-hit rate on fixture |
| `top10_relatedness` | SC-002 style |
| `english_gate` | pass/fail existing nightly/bench |
| `vector_precision` | only after #806 |
| `decision` | adopt \| reject + reason |

## Constants (config surface — code, not env)

| Constant | Value | Role |
|----------|-------|------|
| `FTS_OR_ABOVE_TOKEN_COUNT` | 5 | Short vs long **classification** (unchanged number) |
| `FTS_MAX_TOKENS_FOR_OR` | 8 | Long-path term cap |
| `FTS_MIN_PREFIX_STEM_LENGTH` | 2 | **New** — prefix eligibility |

No new env keys (Q14).

## Validation rules

1. User input never injects FTS operators; only builder-emitted `OR` and `*`.
2. Prefix never applied when `length < 2`.
3. Ranking weights / vector threshold constants are not part of this model (Out of Scope).

## State transitions (adoption)

```text
[measure variants] → [ablation record]
        │
        ├─ SC-001/003 + English OK + (if vector used) #806 OK + SC-002 OK
        │         → ADOPT OR+prefix as buildFTSQuery default
        └─ precision not absorbed OR English fail
                  → REJECT (keep prior short AND behavior) + record reason
```
