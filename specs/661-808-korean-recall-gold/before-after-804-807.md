# Before / after #804 / #807 (#808 / US4)

**Status**: `incomplete` (FR-020) — paired SHA/scorecard sides are not both present.

One-sided snapshots may be noted later, but US4 / SC-004 stay **incomplete** until both before and after conditions exist on the **same** Korean gold fixture and the **same** scorecard metric schema, each with `git_sha` and `ranking_version` (ranking hash).

| Condition | `git_sha` | `ranking_version` | Recall@10 | MRR | Scorecard path (local) | Notes |
|-----------|-----------|-------------------|-----------|-----|------------------------|-------|
| Before #804/#807 | — | — | — | — | — | |
| After #804/#807 | — | — | — | — | — | |
| Ablation / quarantine (optional) | — | — | — | — | — | |

Do **not** invent metrics. Leave cells empty until real scorecards exist.

## Fixture (fixed arm)

Korean gold fixture (measure both conditions against this path):

`tests/fixtures/agent-memory-benchmark-ko`

Optional #804 reuse probes are tagged `triple_isolation_probe` in `queries.json` (e.g. `kq_003`).

## How to fill when scorecards exist

1. Run the Korean arm at condition A (before), save scorecard + report under `.local/` (not committed):

   ```bash
   npm run build -w @memento/core
   npx tsx scripts/agent-memory-benchmark.ts \
     --fixture tests/fixtures/agent-memory-benchmark-ko \
     --arm korean \
     --production \
     --output .local/korean-gold/before/results.json \
     --scorecard-out .local/korean-gold/before/scorecard.json
   ```

2. Run condition B (after quarantine / #807 on, or prior-SHA checkout for “before” if needed) the same way → `after/` paths.

3. Copy into the table: `reproduction.git_sha`, `ranking_version`, aggregate `recall_at_10`, `mrr`. Prefer local scorecard paths in Notes; never commit LoCoMo or live bodies.

4. Only when **both** Before and After rows are filled with matching schema → set status to complete and claim SC-004.
