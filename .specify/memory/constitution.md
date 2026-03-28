# Memento Constitution

## Core Principles

### I. Test-First Delivery (MUST)
All feature and bug-fix changes MUST follow Red-Green-Refactor:
1) write or update failing tests first, 2) implement minimal passing code, 3) refactor safely.
No change is complete until relevant tests pass.

### II. Backward Compatibility for Public Contracts (MUST)
Existing MCP tool contracts and stable API behavior MUST remain backward compatible unless a separate breaking-change plan is approved.
When behavior changes are unavoidable, migration and compatibility notes MUST be documented in spec/plan/tasks.

### III. Schema and Migration Discipline (MUST)
Any database schema change MUST ship with explicit migration files and synchronized schema artifacts.
Schema, migration, and affected type definitions MUST be updated together.

### IV. Quality Gates Before Completion (MUST)
Before claiming implementation complete, `npm run lint`, `npm run type-check`, and `npm test` MUST pass.
Failing gates block completion and handoff.

### V. Observability and Failure Isolation (SHOULD)
Operational failures SHOULD be observable with structured logs and SHOULD NOT break primary response paths when graceful degradation is possible.

## Additional Constraints

- Runtime baseline: Node.js 20+ with TypeScript ES modules.
- Package management baseline: npm workspaces.
- Security/auth scope changes require explicit specification and are not implied by implementation details.

## Development Workflow

- spec.md defines requirements and measurable outcomes.
- plan.md defines architecture, constraints, and phased implementation strategy.
- tasks.md defines executable work items traceable to requirements.
- All three artifacts MUST remain mutually consistent before implementation.

## Governance

This constitution supersedes spec, plan, and tasks when conflicts occur.
Amendments require explicit documentation updates in this file and downstream artifact reconciliation.

**Version**: 1.0.0 | **Ratified**: 2026-03-27 | **Last Amended**: 2026-03-27
