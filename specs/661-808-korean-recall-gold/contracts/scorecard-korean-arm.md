# Contract: Scorecard Korean / remasure arm

**Feature**: 661-808-korean-recall-gold  
**Producer**: `scripts/agent-memory-benchmark.ts` (+ production adapter)

## Labels

| Arm | How invoked | `measure_only` |
|-----|-------------|----------------|
| `korean` | `--fixture tests/fixtures/agent-memory-benchmark-ko --arm korean --production` | true |
| `locomo_prod` | `--locomo .local/locomo/locomo10.json --production` | true for #808 remasure docs |

Arm must be explicit when CLI supports multi-arm; mixed EN+KO single aggregate key = error (FR-019). Korean gold fixture path (`agent-memory-benchmark-ko`) **requires** `--arm korean`.

## Required fields (FR-002 / FR-022)

| Field | Location |
|-------|----------|
| `recall_at_10` | `scorecard` and/or `retrieval.memento_prod` |
| `mrr` | same |
| `ranking_version` | `scorecard` + `reproduction` |
| `embedding_provider` | `scorecard` |
| `git_sha` | `reproduction` (keep full `--output` report) |
| `dataset_sha256` / `dataset_revision` | `scorecard` |

nDCG optional; not an #808 success criterion.

## Forbidden

- Promoting incomplete LoCoMo run as post-fix baseline (FR-018).
- Inventing numeric pass/fail on Korean R@10/MRR (FR-024).
- Committing raw LoCoMo results bodies to git — aggregates/hashes only in specs/*.md.

## Compatibility

Additive labels only. Existing English fixture / LoCoMo keys unchanged (FR-011).
