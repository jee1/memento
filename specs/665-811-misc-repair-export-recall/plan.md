# Implementation Plan: misc repair export · 손상 필터 · -32603 (#811)

**Branch**: `feature/fix-misc-repair-export-recall-32603` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)
**Issue**: [#811](https://github.com/jee1/memento/issues/811) | **Epic**: [#803](https://github.com/jee1/memento/issues/803)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. `progress.yml` has `execute.auto_approve_phases: true` — do **not** pause for human phase checkpoints. Spec Kit next step: `/speckit.tasks` → `tasks.md`.

**Goal:** Restore repair-script imports, stop corrupted triple sentences from starving injection budgets, map client validation failures to MCP `-32602`, document diagnostic `auto_set_anchor: false`, and unify hybrid distance→similarity via `cosineDistanceToSimilarity`.

**Architecture:** Five independent slices. (1) Build/export smoke for `@memento/core`. (2) Adaptive overfetch + early `hasBrokenTripleConjugation` filter in knowledge-context-bundle (fixed `*2`/`*6` alone is insufficient). (3) Shared `ToolInputValidationError` (stable `name`) thrown by recall/remember; `mapToolExecutionErrorToJsonRpc` → `-32602`. (4) Docs-only agent-workflow note. (5) Hybrid SQL returns distance; mapper converts once.

**Tech Stack:** TypeScript 5.x, Node ≥24, Vitest, better-sqlite3, Express/MCP dispatch (`audit-tool-dispatch`).

**Spec:** [specs/665-811-misc-repair-export-recall/spec.md](./spec.md)

## Global Constraints

- No MCP parameter schema change (error **code mapping** only) — OQ-2
- No `hasBrokenTripleConjugation` expansion to `함합니다` — #781 / FR-004
- No fragile content `LIKE` as sole exclusion — OQ-3 / #804 FR-002i
- Keep repair script (do not delete) — OQ-1
- Docs only for diagnostic probes — OQ-6
- Backtick remember hypothesis non-blocking if unreproduced — OQ-5
- TDD Red-Green-Refactor (Constitution I); lint/type-check/tests + graphify (IV)
- Synthetic fixtures only; no live DB_PATH in CI

---

## Summary

#811 bundles operational leftovers from Epic #803. Worktree lacks `packages/memento-core/dist`, so repair CLI cannot import named exports. Injection still uses fixed overfetch then post-filters broken conjugations, emptying shortlists. Validation errors (`RecallInputValidationError` / plain `Error` from remember) fall through to `-32603`. Docs omit `auto_set_anchor: false`. Hybrid SQL still embeds `1 - distance` contrary to #806 FR-020 residual R1. This plan fixes each slice with colocated tests. Details: [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: `@memento/core`, `@memento/server` dispatch, Vitest, Zod  
**Storage**: SQLite `memory_item` (no DDL)  
**Testing**: Vitest domain + server utils + script smoke; synthetic DB  
**Target Platform**: MCP stdio/HTTP + operator CLI  
**Performance Goals**: Adaptive overfetch capped (e.g. max multiplier / absolute limit) to avoid unbounded search  
**Constraints**: FR-004 #781; no abs path dumps; Principle II error-code correction  
**Scale/Scope**: ~8–12 production files + tests + short docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design — **all PASS**.*

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I | PASS | RED first per US; docs-only US4 may skip code TDD |
| Backward compatibility | II | PASS | Params unchanged; `-32602` for validation is contract correction |
| Schema/migration | III | PASS | No DDL |
| Quality gates + graphify | IV | PASS | SC-005; graphify after prod code |
| Observability / isolation | V | PASS | Empty injection + warn; no throw on all-corrupted |
| Additional Constraints | Additional | PASS | Node 24 workspaces; synthetic fixtures; no auth scope |

## Project Structure

### Documentation (this feature)

```text
specs/665-811-misc-repair-export-recall/
├── spec.md
├── plan.md              # This file
├── research.md
├── data-model.md
├── quickstart.md
├── progress.yml
└── tasks.md             # /speckit.tasks
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── index.ts                                      # already exports buildTripleSentence
├── shared/errors/tool-input-validation-error.ts  # NEW (or shared/utils/)
├── domains/memory/recall/recall-tool.ts          # throw ToolInputValidationError
├── domains/memory/remember/remember-tool.ts      # same
├── domains/memory/services/knowledge-context-bundle-builder.ts  # adaptive overfetch
├── domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts
├── domains/search/repositories/vector-search/
│   ├── vector-search-hybrid-query.ts             # return distance
│   ├── vector-search-result-mapper.ts            # cosineDistanceToSimilarity
│   ├── vector-search.types.ts
│   └── *.spec.ts
packages/memento-server/src/server/utils/
├── mcp-tool-call-error.ts                        # map validation → -32602
└── mcp-tool-call-error.spec.ts
scripts/
├── repair-triple-sentence-memories.ts            # consume exports (verify after build)
└── (optional) core-export-smoke.spec.ts OR extend repair spec
docs/agents/agent-workflow.md                     # auto_set_anchor: false
AGENTS.md                                         # §3.1 one-liner if needed
```

**Structure Decision**: No new package. Shared validation error in core so both tools and server mapper agree on `name`/instanceof.

## Complexity Tracking

No constitution violations.

## Phase 0 — Research highlights

See [research.md](./research.md): dist missing confirmed; fixed `*2`/`*6` insufficient; remember throws plain `Error`; hybrid ORDER BY needs distance column + mapper convert.

## Phase 1 — Design

### Data model

No schema change. Logical entities in [data-model.md](./data-model.md).

### Contracts

- MCP: validation failures → JSON-RPC `-32602` with descriptive `data`
- Internal: `error.name === 'ToolInputValidationError'` (or class export)

### Testing strategy

| Story | RED first |
|-------|-----------|
| US1 | Assert named exports from `@memento/core` (after build) or import graph smoke |
| US2 | Fixture: many broken + few clean; `maxMemories` filled with clean only |
| US3 | `mapToolExecutionErrorToJsonRpc` / dispatch: type-missing → `-32602` |
| US4 | N/A (docs) |
| US5 | Mapper/hybrid: SQL path distance → similarity equals `cosineDistanceToSimilarity` |

### Execution strategy

- `[P][SUBAGENT]`: US1 ∥ US3 ∥ US5 after foundational shared error type if US3 needs it first
- Order: Foundational (`ToolInputValidationError` if shared) → parallel US1/US2/US3/US5 → US4 docs → polish gates
- `auto_approve_phases: true`

## Phase 2 — Implementation outline (detail in tasks.md)

1. **Foundational**: Add `ToolInputValidationError` in core; export from index if needed for server instanceof (or map by `name` to avoid circular deps — prefer `name` check in server if core class hard to import).
2. **US1**: Ensure build; export smoke test; verify repair script imports.
3. **US2**: Adaptive loop: start multiplier, filter broken, if `clean.length < maxMemories` and more candidates possible, increase limit up to cap; DiD post-filter; warn when empty/excluded.
4. **US3**: Wire recall/remember to shared error; extend `mapToolExecutionErrorToJsonRpc`; optional backtick repro attempt.
5. **US4**: Document diagnostic probe guidance.
6. **US5**: Hybrid query returns distance; `mapHybridResults` uses `cosineDistanceToSimilarity`; update specs/comments (#713/#806).
7. **Polish**: lint, type-check, targeted tests, graphify.

## Risks

| Risk | Mitigation |
|------|------------|
| Adaptive overfetch unbounded | Hard cap (e.g. max(limit)=maxMemories*16 or 100) |
| Server cannot instanceof core error | Map `error instanceof Error && error.name === 'ToolInputValidationError'` |
| Hybrid ORDER BY breaks | Keep SQL rank expression using `1-d` for sort only; returned score via shared util |
| Stale dist in CI | Workspace `npm run build` / test imports from source via vitest alias — match existing patterns |
