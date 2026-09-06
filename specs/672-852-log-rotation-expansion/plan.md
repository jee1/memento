# Implementation Plan: Expand log_rotation Beyond Triple-Extraction

**Branch**: `feature/chore-ops-log_rotation-triple-extraction-migrati` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/672-852-log-rotation-expansion/spec.md`  
**Issue**: [#852](https://github.com/jee1/memento/issues/852)

## Summary

Extend the existing `log_rotation` batch job so it cleans **known log families** under
resolved roots—not only `tripleExtractionLogger.deleteOldLogs(30)`. Apply the #849 lesson:
**count (and byte) caps with age**, because high-churn in-window files never age out.
Introduce a small filesystem rotation module used by `runLogRotation`, keep TE age behavior,
add migration keepCount=500, docker-diagnostics maxTotalBytes=256MiB, and monitor jsonl trim
while preserving `state.json`.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: existing batch-scheduler, `fs/promises`, path validation helpers  
**Storage**: local filesystem under configured logs roots (no DB schema)  
**Testing**: Vitest (temp directories; never live `~/.memento`)  
**Target Platform**: Linux server / Docker Compose ops  
**Project Type**: npm workspaces library (`@memento/core`) + scheduler handler  
**Performance Goals**: rotate thousands of small migration logs in one job without blocking
primary MCP paths (job already async/batch)  
**Constraints**: no absolute path leakage in reports; soft-fail per file; path traversal guards  
**Scale/Scope**: ops dirs currently ~10k migration files / hundreds of MB diagnostics

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | High-churn fixtures + family unit tests before wiring handler |
| Backward compatibility | II (MUST) | PASS | MCP tools unchanged; job type `log_rotation` retained; result shape additive |
| Schema/migration | III (MUST) | N/A | Filesystem only |
| Quality gates + graphify | IV (MUST) | PASS | lint/type-check/test + graphify after production code |
| Observability / isolation | V (SHOULD) | PASS | Soft-fail + structured job logs; unlink errors do not crash MCP |
| Additional Constraints | Additional | PASS | Node 24/TS ESM; no corpus; no new auth surface |

Post-design re-check: unchanged PASS/N/A.

## Project Structure

### Documentation (this feature)

```text
specs/672-852-log-rotation-expansion/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── log-rotation-job.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/memento-core/src/infrastructure/logging/
├── triple-extraction-logger.ts          # keep deleteOldLogs; may delegate age helper
├── log-rotation.ts                      # NEW: multi-family rotation orchestrator
├── log-rotation-policies.ts             # NEW: defaults + env overrides
├── log-rotation-paths.ts                # NEW: root resolvers (injectable)
└── __tests__/ or *.spec.ts
    ├── log-rotation.spec.ts             # NEW: high-churn + families
    └── triple-extraction-logger.spec.ts # existing age tests stay green

packages/memento-core/src/infrastructure/scheduler/handlers/
└── batch-scheduler-consolidation-relation-handlers.ts  # runLogRotation → orchestrator

scripts/collect-docker-diagnostics.sh    # optional: lower retain / document total budget
docs/operations/…                        # brief retention notes if needed
```

## Phase Strategy

1. **Foundational**: policies + path resolvers + report type (no abs paths).
2. **US1/US4**: migration count-cap selector + high-churn regression tests.
3. **US2**: docker-diagnostics byte-budget cleanup (+ optional collector tweak).
4. **US3**: TE age via shared helper + monitor trim preserving `state.json`.
5. **Wire**: `runLogRotation` aggregates family reports into `BatchJobResult`.
6. **Polish**: docs gotcha, AGENTS note if useful, graphify, quality gates.

## Complexity Tracking

None — no constitution violations.
