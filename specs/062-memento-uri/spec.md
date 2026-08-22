# Feature Specification: Canonical Memento Resource URIs

**Feature Branch**: `062-memento-uri`
**Created**: 2026-07-10
**Status**: Planned
**Parent**: #655, prerequisite issue #656

## User Scenarios & Testing

### User Story 1 - Follow a canonical memory reference (Priority: P1)

An agent receives a recall result and can retain a stable, owner-scoped URI alongside the existing `mem_*` identifier.

**Why this priority**: #659 outbox and #660 audit records need one interoperable target handle without breaking current MCP consumers.

**Independent Test**: Format and parse an owner-scoped URI, then assert recall returns the same URI for a memory with that owner.

**Acceptance Scenarios**:

1. **Given** an `agent-a` semantic memory `mem_123`, **When** it is recalled, **Then** its result includes `memento://agent-a/memory/mem_123` and still includes `memory_id`.
2. **Given** a memory with no stored owner, **When** a URI is formatted, **Then** its canonical owner segment is `default`.

---

### User Story 2 - Exchange URI-bearing memory data (Priority: P2)

An operator can export memory records or inspect feedback and relation results with canonical URIs while existing IDs remain accepted.

**Why this priority**: Export/import and graph consumers need a migration-safe external reference.

**Independent Test**: Export a memory, submit feedback, and retrieve a relation; each response carries the correct URI fields.

**Acceptance Scenarios**:

1. **Given** a procedural memory, **When** it is exported, **Then** the record contains a `memento://{owner}/procedure/{id}` URI.
2. **Given** a feedback event or relation response, **When** it is returned, **Then** it includes canonical resource URI fields without replacing legacy ID fields.

### Edge Cases

- URI components containing spaces, slashes, or percent signs are percent encoded during formatting and restored during parsing.
- Invalid schemes, unknown resource kinds, extra path segments, and empty owner or resource IDs are rejected.
- The existing `memento://memory/{id}` source URI remains valid as a legacy alias; new output uses the owner-scoped form.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST format and parse `memento://{owner}/{memory|procedure|anchor|relation}/{id}` URIs.
- **FR-002**: The system MUST normalize missing owners to `default` and preserve explicit owner identifiers through percent encoding.
- **FR-003**: Recall items MUST expose an optional `uri` while retaining `memory_id` and `id`.
- **FR-004**: Feedback, relation, and export responses MUST expose canonical URI fields without requiring callers to replace legacy IDs.
- **FR-005**: Source URI validation MUST accept the canonical form and the prior `memento://memory/{id}` form during migration.
- **FR-006**: The public reference MUST define ownership, procedural-memory mapping, escaping, and legacy compatibility.

### Key Entities

- **Memento resource URI**: A stable URI made of an owner, resource kind, and local resource ID.
- **Legacy identifier**: Existing `mem_*` IDs and `memory://` MCP resource URIs, which remain valid and are not rewritten.

## Success Criteria

- **SC-001**: Unit tests prove all four resource kinds round-trip through the URI parser.
- **SC-002**: Recall, feedback, relation, and export tests prove their legacy IDs remain present with their new URI fields.
- **SC-003**: Type-check, lint, and affected test suites pass without changing database schema.
