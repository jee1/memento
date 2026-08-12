# p95 comparison (#735)

CI-gated measurements (2026-08-12, this worktree). Not a full LongMemEval production scorecard.

| Path | Before | After |
|------|--------|-------|
| `include_metadata=true` recall, mocked hybrid search | 158ms (fixed 150ms sleep in `getMetaStatsForResults`) | <80ms (`recall-tool.spec` no-sleep case) |
| Hybrid delayed mock: FTS 80ms + vector 40ms | 122ms (serial sum) | 82ms (≈ max branch) |

Merge gate is these targeted tests. Live production p95: re-run `npm run quality:agent-memory:production` (#737) when the fixture is available.
