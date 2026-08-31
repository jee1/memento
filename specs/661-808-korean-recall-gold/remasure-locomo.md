# LoCoMo remasure (#808 / US1)

**Status**: `blocked` — corpus not acquired (`.local/locomo/` absent in this worktree).

Do **not** invent Recall@10 / MRR / SHA / ranking hash / provider values. Placeholders below stay empty until a full eligible `memento_prod` run completes.

| Field | Value |
|-------|-------|
| Dataset | LoCoMo 1,536 (`memento_prod`) |
| Dataset revision | — |
| `git_sha` | — |
| `ranking_version` | — |
| `embedding_provider` | — |
| Recall@10 | — |
| MRR | — |
| Comparable to #785 (FR-029) | — |
| Report path (local only) | — |

## SC-001

**Not satisfied** until measured: SC-001 requires at least one recorded current-tree `memento_prod` Recall@10 and MRR on an acquired LoCoMo environment. Missing acquire → US1 incomplete / blocked, not “feature complete.”

## Fail-closed (FR-018)

Incomplete, interrupted, or partial LoCoMo run artifacts MUST be labeled `failed` / `incomplete` only.

They **must not** be promoted or published as the post-#785 production baseline — even if some aggregate numbers appear in a partial report. Only a complete eligible-set measurement (non-adversarial session-level evidence, documented provider comparable to #785 per FR-029) may fill this scorecard and claim SC-001.

## Procedure (when corpus acquired)

From [quickstart.md](./quickstart.md):

```bash
npm run quality -- locomo acquire
npm run build -w @memento/core
npx tsx scripts/agent-memory-benchmark.ts \
  --locomo .local/locomo/locomo10.json \
  --production \
  --output .local/locomo/latest/results.json
```

Then copy **aggregates only** into the table above: Recall@10, MRR, `git_sha`, `ranking_version`, embedding provider, dataset revision. Never commit `.local/locomo/` or raw LoCoMo bodies.

### FR-029 — provider comparability

When the remasure eventually runs, record the actual embedding provider on the scorecard / reproduction metadata and state whether the condition is **comparable to #785**. If provider (or other production procedure knobs) diverge from the documented #785 `memento_prod` setup, set **Comparable to #785** to `no` with a short reason — do not silently treat numbers as a like-for-like post-#785 baseline.
