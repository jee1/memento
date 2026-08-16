# LoCoMo 1,536 scorecard (#785 / T045)

**Date**: 2026-08-16  
**Status**: skipped in this worktree — `.local/locomo/` is absent.

SC-006 (Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s) and SC-007 category regression need a solo production run against acquired LoCoMo (`npm run quality:locomo:acquire` then `--production`). CI must not vendor the CC BY-NC corpus.

Pre-epic published snapshot (`docs/_work/testing/locomo/latest/results.json`, 2026-08-16): `memento_prod` Recall@10 **0.381**, p95 66.6 ms. That file is not a post-#787/#788/#789 scorecard. Re-run locally after acquire; do not commit `locomo10.json`.
