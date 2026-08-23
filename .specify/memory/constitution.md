<!--
Sync Impact Report — 2026-08-22 amendment

Version change: 1.1.0 → 1.2.0
Bump rationale: MINOR. Two existing enforcement practices were promoted into normative
text — Principle IV gained a scoped graphify gate, and Additional Constraints gained a
benchmark-corpus licensing rule. No principle was removed or redefined, and no prior
rule became stricter for work already compliant with AGENTS.md, so this is not MAJOR.

Modified principles:
- IV. Quality Gates Before Completion — added a graphify rebuild gate, scoped to
  production code changes. Title unchanged.

Added sections: none (a new bullet was added inside Additional Constraints)
Removed sections: none

Placeholder audit: no `[ALL_CAPS_IDENTIFIER]` tokens remain in this file. All five
principles (I–V), Additional Constraints, Development Workflow, and Governance carry
concrete project text.

Sources for the amendments:
- Graphify gate: AGENTS.md §3 ("코드를 고치는 에이전트는 ... 수정 후에도 graphify를
  재빌드합니다") and §3.1; Principle IV gate rows in specs/060, 061, and 064 already
  list graphify alongside lint/type-check/test.
- Corpus licensing: AGENTS.md §3.1 "LoCoMo 라이선스 (#767)" — CC BY-NC 4.0, no raw or
  derived corpus commits, synthetic fixtures only, aggregates/IDs/hashes in public docs.

Templates / artifacts checked:
- .specify/templates/plan-template.md — ✅ aligned, no edit needed. Its `[Gates
  determined based on constitution file]` line is an intentional slot filled per-feature
  by /speckit.plan; specs/060, 061, and 064 each render it as an I–V gate table, so both
  amendments flow into new plans without a template change.
- .specify/templates/spec-template.md — ✅ aligned. Mandatory User Scenarios / FR-* /
  SC-* sections impose no constraint these amendments contradict.
- .specify/templates/tasks-template.md — ✅ aligned. The Polish phase already carries
  documentation and cross-cutting tasks; graphify is a gate, not a new task category.
- .specify/templates/checklist-template.md — ✅ no constitution references.
- .specify/templates/commands/*.md — N/A, directory does not exist in this checkout.
- README.md, docs/ — ✅ no constitution references to reconcile. AGENTS.md §3/§3.1
  already states both rules and needs no change.

Follow-up TODOs: none. Both previously deferred items (GRAPHIFY_GATE,
DATASET_LICENSING) were adopted in this amendment.
-->
# Memento Constitution

## Core Principles

### I. Test-First Delivery (MUST)
All feature and bug-fix changes MUST follow Red-Green-Refactor:
1) write or update failing tests first, 2) implement minimal passing code, 3) refactor safely.
No change is complete until relevant tests pass.

**Structural refactoring exception (amended 2026-04-13)**: A program whose **sole deliverables** are structural code reorganization, boundary clarification, and maintainer-facing documentation — with **no new features and no defect fixes** — is **not** a "feature or bug-fix change" for purposes of this principle. For such programs, the existing automated CI suite (green baseline before each increment; red if parity breaks) satisfies the Red-Green-Refactor intent as the regression signal. If any increment within such a program introduces new behavior or fixes a defect, **that increment MUST follow Red-Green-Refactor in full**. Doubt MUST be resolved conservatively — apply the full principle unless the increment is clearly documentation-only or type-only.

### II. Backward Compatibility for Public Contracts (MUST)
Existing MCP tool contracts and stable API behavior MUST remain backward compatible unless a separate breaking-change plan is approved.
When behavior changes are unavoidable, migration and compatibility notes MUST be documented in spec/plan/tasks.

### III. Schema and Migration Discipline (MUST)
Any database schema change MUST ship with explicit migration files and synchronized schema artifacts.
Schema, migration, and affected type definitions MUST be updated together.

### IV. Quality Gates Before Completion (MUST)
Before claiming implementation complete, `npm run lint`, `npm run type-check`, and `npm test` MUST pass.
Failing gates block completion and handoff.

**Graphify gate (amended 2026-08-22)**: A change that touches production code MUST also rebuild the graphify report and confirm `graphify-out/GRAPH_REPORT.md` before completion. This gate does **not** apply to documentation-only or specification-only changes. Rationale: graphify is the repository's structural-drift signal, and a stale report hides boundary violations that lint and type-check cannot see. `graphify-out/` is a local build artifact and MUST NOT be committed.

### V. Observability and Failure Isolation (SHOULD)
Operational failures SHOULD be observable with structured logs and SHOULD NOT break primary response paths when graceful degradation is possible.

## Additional Constraints

- Runtime baseline: Node.js 24+ with TypeScript ES modules.
- Package management baseline: npm workspaces.
- Security/auth scope changes require explicit specification and are not implied by implementation details.
- Benchmark corpus licensing (added 2026-08-22): Non-redistributable third-party corpora and any data derived from them MUST NOT be committed to this repository. Committed test fixtures MUST be synthetic, and public documentation MUST report only aggregates, identifiers, or hashes. The governing instance is the LoCoMo dataset (CC BY-NC 4.0, issue #767); the rule applies to every corpus whose license forbids redistribution.

## Development Workflow

- spec.md defines requirements and measurable outcomes.
- plan.md defines architecture, constraints, and phased implementation strategy.
- tasks.md defines executable work items traceable to requirements.
- All three artifacts MUST remain mutually consistent before implementation.

## Governance

This constitution supersedes spec, plan, and tasks when conflicts occur.
Amendments require explicit documentation updates in this file and downstream artifact reconciliation.

**Version**: 1.2.0 | **Ratified**: 2026-03-27 | **Last Amended**: 2026-08-22
