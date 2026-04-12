# Implementation Plan: Production Maintainability Refactoring Approach

**Branch**: `013-refactor-approach` | **Date**: 2026-04-12 | **Spec**: `specs/013-refactor-approach/spec.md`  
**Input**: Feature specification from `specs/013-refactor-approach/spec.md`

**Note**: Filled by `/speckit.plan`. Workflow reference: `.specify/templates/plan-template.md`.

## Summary

This program delivers **incremental, independently releasable refactors** across six capability areas (agent memory recall, hybrid search execution, scheduled background coordination, relationship extraction, administrative HTTP, embedding pipeline) under **behavioral parity**—no new product features, no intentional user- or operator-visible behavior changes, and **no** database schema or on-disk persistence changes in the **first wave**. Success is measured by **maintainability** (clear boundaries, less unsafe generic crossing, consolidated admin registration reviewability) and **parity** (CI plus agreed manual regression where **FR-013** applies). Primary living artifacts are **`maintainer-map.md`** (FR-007/FR-017) and **`manual-regression-checklist.md`** (FR-020), both **in-repo** under this feature directory (FR-025, FR-027).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥ 20, ES modules  
**Primary Dependencies**: npm workspaces — `packages/memento-core` (`@memento/core`), `packages/memento-server` (MCP + Express HTTP admin), `packages/memento-client` (`@memento/client`); `better-sqlite3`, `zod`, Vitest, Express 5.x (server)  
**Storage**: SQLite (`better-sqlite3`); **first wave** — no migrations or stored-format changes (FR-009)  
**Testing**: Vitest (`npm test`, co-located `*.spec.ts`); scenario runners (`npm run test:search`, `npm run test:forgetting`, `npm run test:client`, `npm run test:batch-scheduler`, etc.—see root `package.json`)  
**Target Platform**: Node 20+ on Linux/macOS/Windows for dev and server deployment  
**Project Type**: Monorepo — core library + MCP/HTTP server + client SDK  
**Performance Goals**: **Out of scope** as program acceptance metrics (FR-010); incidental changes possible but not goals  
**Constraints**: Behavioral parity; CI mandatory on every merge to the integration line; **FR-013** mandatory manual regression only for **direct** changes to memory recall, hybrid search, or administrative HTTP **runtime behavior or request-handling paths**; **FR-026** (documentation-only, type-only, emit-equivalent) and **indirect-only** changes from other capability areas **do not** by themselves mandate FR-013 manual gate; heuristic quality tools **not** program merge gates (FR-015)  
**Scale/Scope**: Six capability areas; first wave **complete** when each has ≥1 releasable increment merged to the integration line (FR-014)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| **I. Test-First Delivery** | **PASS** | This program consists exclusively of **structural refactoring** (code reorganization, boundary clarification, documentation)—it introduces **no new product features** and fixes **no defects**. The Principle I MUST therefore applies under its “feature and bug-fix changes” scope; a purely structural refactoring program is **not** a feature change or bug-fix change and does not invoke the write-failing-tests-first obligation. Red–Green–Refactor is satisfied for this program by **existing** automated tests in CI as the primary regression signal (“green” baseline before refactor; “red” if parity breaks); **FR-024** does not require **new** automated tests as a program merge gate. Teams **may** add tests when helpful. |
| **II. Backward Compatibility (public contracts)** | **PASS** | Program forbids intentional behavior change; MCP tools and stable HTTP semantics remain compatible unless escalated outside this program. |
| **III. Schema and Migration Discipline** | **PASS** | First wave excludes schema/migration work (FR-009). |
| **IV. Quality Gates Before Completion** | **PASS** | `npm run lint`, `npm run type-check`, `npm test` required per constitution and FR-013 CI clause. |
| **V. Observability and Failure Isolation** | **PASS** | FR-011 requires a short operational touchpoint summary per increment. |

**Principle I — contributor note (RGR vs FR-024):** The constitution’s Red–Green–Refactor cycle applies to this program as follows: **existing** automated tests in CI establish the **green** baseline before each refactor increment; any parity break should **fail** those tests (the **red** signal). Contributors **do not** need to add **new** test files or extend coverage **solely** to close a coverage gap (**FR-024**). Teams **may** and **should** add tests when they materially reduce regression risk or clarify intent.

**Principle I — governance note:** The exception above (structural refactoring falls outside the "feature and bug-fix changes" scope of Principle I) is **formally codified** in `constitution.md` v1.1.0 (amended 2026-04-13) under the "Structural refactoring exception" clause. If any future increment in this program introduces new behavior or fixes a defect, that increment **must** follow Principle I in full (write failing tests first). Any doubt about whether an increment qualifies as purely structural MUST be resolved conservatively—apply Principle I unless the increment is clearly documentation-only or type-only.

**Post–Phase 1 re-check**: Design artifacts add **documentation only** under `specs/013-refactor-approach/`; **no** constitution violations introduced.

## Authoritative program entries (FR-016, FR-018, FR-020, FR-023, FR-025, FR-027)

| Entry | Canonical value |
|--------|-----------------|
| **Integration line** | `main` — long-lived default merge target for FR-013/FR-014. If the team uses a different integration branch, **update this plan** and communicate. |
| **Primary maintainer document (FR-007/FR-017)** | `specs/013-refactor-approach/maintainer-map.md` |
| **Manual regression checklist — full text (FR-020)** | `specs/013-refactor-approach/manual-regression-checklist.md` |
| **SC-002 primary defect source (FR-023)** | **GitHub Issues** for this repository. Operational filters, recall/search relevance rules, and “statistically meaningful” assessment: **`research.md`** §3 (FR-016). Secondary sources (Discord/email/internal tracker): merge/dedup/precedence rules per **`research.md`** §4 — (1) primary count = GitHub Issue if one exists; (2) secondary reports without an Issue → one synthetic row on triage or excluded; (3) GitHub label/milestone wins. No secondary source may be used without these rules applied (FR-023). |
| **Emergency hotfix vs FR-013 (FR-019)** | Governed by **organization** release/incident policy—not this spec. **`plan.md`** may link a runbook when available. |

## Project Structure

### Documentation (this feature)

```text
specs/013-refactor-approach/
├── spec.md
├── plan.md                    # This file
├── research.md                # Phase 0
├── data-model.md              # Phase 1
├── quickstart.md              # Phase 1
├── maintainer-map.md          # FR-007/FR-017 (authoritative, updated as increments land)
├── manual-regression-checklist.md
├── contracts/                 # Phase 1
└── tasks.md                   # Phase 2 — generated by /speckit.tasks (not by /speckit.plan)
```

### Source Code (repository root)

```text
packages/memento-core/src/
  domains/memory/ recall-related services
  domains/search/ hybrid search, ranking
  domains/embedding/
  domains/forgetting/
  domains/anchor/
  domains/relation/
  domains/monitoring/
  domains/procedural/
  infrastructure/

packages/memento-server/src/
  server/ MCP + HTTP admin

packages/memento-client/src/

src/test/           scenario & E2E drivers (test-*.ts)
tests/              fixtures & integration
```

**Structure Decision**: Refactors apply within existing **`packages/memento-core`** and **`packages/memento-server`** boundaries; no additional packages required for the first wave.

## Complexity Tracking

> **No** constitution violations requiring justification — table left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

---

## Phase 0: Research

Consolidated in **`specs/013-refactor-approach/research.md`**. No unresolved **NEEDS CLARIFICATION** items remain in Technical Context.

## Phase 1: Design & contracts

- **`data-model.md`** — program conceptual model  
- **`contracts/`** — merge-gate and public-surface expectations  
- **`quickstart.md`** — contributor workflow  

Agent context updated via `.specify/scripts/bash/update-agent-context.sh cursor-agent`.

## Phase 2

Executable work items live in **`tasks.md`**, generated by **`/speckit.tasks`**. **`/speckit.plan`** does not author that file; keep **`tasks.md`** aligned with **`spec.md`** after task-generation workflows.

## Program alignment verification (T001 snapshot)

- **Integration line** `main`, **maintainer map** `specs/013-refactor-approach/maintainer-map.md`, **manual regression** `specs/013-refactor-approach/manual-regression-checklist.md`, **SC-002 source** GitHub Issues + `research.md` §3–4 — consistent with **`spec.md`** FR-016/FR-018/FR-020/FR-023.
- **`contracts/merge-gates.md`**: CI + conditional manual + FR-026 exemptions — aligned with **FR-013**.
- **`contracts/public-surface-stability.md`**: MCP tool names + admin HTTP expectations — aligned with Constitution II and **FR-009**.
