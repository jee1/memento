# Implementation Plan: Fix hybrid ranker importance 0 → 0.5 (#924)

**Branch**: `feature/hybrid-importance-0-0.5` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/677-924-fix-hybrid-importance-zero/spec.md`

## Summary

Replace truthy defaulting of `importance` in hybrid result ranking with nullish
defaulting so `0` stays `0`, while missing values still default to `0.5`. Add a
monotonicity regression for `0 < 0.1 < 0.5` under equal other signals.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js ≥24 (ESM)  
**Primary Dependencies**: Vitest, `@memento/core` search domain  
**Storage**: N/A (in-memory ranker unit test)  
**Testing**: Vitest `hybrid-result-ranker.spec.ts`  
**Target Platform**: library (MCP/HTTP search path)  
**Project Type**: monorepo package `memento-core`  
**Performance Goals**: N/A (O(1) field default)  
**Constraints**: Surgical fix; no ranking weight changes; no schema change  
**Scale/Scope**: 1 production line + 1–2 tests

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I | PASS | RED test for 0/0.1/0.5 then GREEN `??` |
| MCP/API backward compat | II | PASS | Missing importance still 0.5; only 0 behavior corrects |
| Schema/migrations | III | N/A | No schema |
| Quality gates | IV | PASS | domain test + type-check; graphify after code |
| Observability | V | N/A | No new ops path |
| Additional Constraints | — | PASS | Matches AGENTS gotcha (episodic importance 0 must not `\|\| 0.5`) |

## Project Structure

### Documentation (this feature)

```text
specs/677-924-fix-hybrid-importance-zero/
├── plan.md
├── spec.md
├── tasks.md
├── progress.yml
└── checklists/requirements.md
```

### Source Code

```text
packages/memento-core/src/domains/search/algorithms/hybrid-result-ranker.ts
packages/memento-core/src/domains/search/algorithms/hybrid-result-ranker.spec.ts
```

Optional touch (only if types force): none expected.
`hybrid-search-engine.ts` listed in issue impact path but no `|| 0.5` there — verify only.

## Execution Strategy

1. **TDD**: Add failing monotonicity + nullish-default tests.
2. **Fix**: `importance: result.importance || 0.5` → `importance: result.importance ?? 0.5` in `buildBaseFeatures`.
3. **Gates**: domain vitest → type-check → graphify rebuild.
4. **simplify**: confirm single-line fix, no new helpers.
5. **Review**: superspec.review vs FR/SC. No commit/push unless asked.

## Complexity Tracking

None — no constitution violations.
