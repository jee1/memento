<!--
Sync Impact Report — 2026-09-06 validation (prelude to /speckit.specify #852)

Version change: 1.3.0 → 1.3.0 (NO amendment)
Bump rationale: none. `/speckit.constitution` invoked as prelude to
`/speckit.specify` for issue #852 (expand `log_rotation` beyond
triple-extraction to migration logs, docker-diagnostics, and
log-issue-monitor with count/byte caps). No principle, constraint,
workflow rule, or governance clause added, removed, or redefined.
Ops retention belongs in the feature spec; Principle I (tests) and V
(observability/failure isolation) already cover soft-fail cleanup.
`Ratified` and `Last Amended` unchanged (Last Amended still 2026-08-27).

Modified principles: none
Added sections: none
Removed sections: none

Placeholder audit: PASS. No `[ALL_CAPS_IDENTIFIER]` tokens remain.
Template resolution: `common.sh` `resolve_template constitution-template`
→ `.specify/templates/constitution-template.md`. No extensions.yml.

Consistency propagation:
- plan/spec/tasks templates — NO CHANGE NEEDED.
- Runtime guidance (`AGENTS.md` §3.1) — NO CHANGE NEEDED for governance;
  feature may add an ops gotcha after implement.

Follow-up TODOs: none. Feature work continues in
`specs/672-852-log-rotation-expansion/` via `/speckit.specify` #852.
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

**Amendment procedure**: Amendments MUST be written into this file with an
updated Sync Impact Report comment, version bump, and `Last Amended`
date. Downstream specs, plans, and tasks that conflict with the new text
MUST be reconciled in the same change set or explicitly tracked as
follow-up work before implementation proceeds under the new rules.

**Versioning policy**: Constitution versions use semantic versioning.
- MAJOR: backward-incompatible removal or redefinition of a principle.
- MINOR: new principle/section or materially expanded normative guidance.
- PATCH: clarifications, wording, typo fixes, non-semantic refinements.

**Compliance review**: Before merge, reviewers MUST verify that the change
set does not violate Principles I–V and Additional Constraints. Plans
produced by Spec Kit MUST include a Constitution Check that maps gates
to these principles. Non-compliance blocks completion and handoff.

**Version**: 1.3.0 | **Ratified**: 2026-03-27 | **Last Amended**: 2026-08-27
