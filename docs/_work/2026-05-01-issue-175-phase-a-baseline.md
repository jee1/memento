# Issue #175 — Bootstrap refactor baseline

**Date:** 2026-05-01

## Issue #175 Phase A — baseline

`wc -l packages/memento-core/src/bootstrap.ts packages/memento-core/src/bootstrap/*.ts`

```text
  146 packages/memento-core/src/bootstrap.ts
   39 packages/memento-core/src/bootstrap/anchor-stack.ts
   52 packages/memento-core/src/bootstrap/batch-telemetry-relation.ts
   15 packages/memento-core/src/bootstrap/failure-reflexion.ts
   67 packages/memento-core/src/bootstrap/monitoring-schedulers.ts
  109 packages/memento-core/src/bootstrap/runtime-diagnostics-sampler.ts
   31 packages/memento-core/src/bootstrap/search-and-embedding.ts
   65 packages/memento-core/src/bootstrap/write-and-meta.ts
  524 합계
```

`sed -n '/export async function initializeServices/,/^}$/p' packages/memento-core/src/bootstrap.ts | wc -l`

```text
75
```

Phase B is deferred until the Phase A verification gate in Task 4 of `docs/superpowers/plans/2026-05-01-issue-175-bootstrap-verify.md` is satisfied.
