# Data Model: Program entities (013-refactor-approach)

This document describes **conceptual entities** for the refactoring **program** (process metadata and ownership), **not** new database tables. The first wave **excludes** schema changes (FR-009).

## Entity: Refactoring increment

| Field | Description |
|-------|-------------|
| `id` | Human-readable identifier (e.g. branch name, PR number, or increment code). |
| `capability_area` | One of the six areas (see below). |
| `intent` | Which maintainability concern is addressed (no new features). |
| `verification` | CI status; manual checklist completion when FR-013 applies. |
| `operational_touchpoints` | Per FR-011: logs/metrics/alerts or “none.” |
| `parity_notes` | How behavioral equivalence was argued (tests run, checklist sections). |

**Relationships**: Many increments map to **one** `capability_area` primary owner; may reference **Manual regression checklist** sections when FR-013 applies.

**Validation**: Must not claim completion without constitution quality gates when code merges.

---

## Entity: Capability area

Enumerated program scope (from assumptions / FR-014):

1. Agent **memory recall**
2. **Hybrid search** execution
3. **Scheduled background** coordination
4. **Relationship extraction** from text
5. **Administrative HTTP** capabilities
6. **Embedding** pipeline

**Relationships**: Each must have ≥1 **Refactoring increment** merged for first-wave completion (FR-014).

**Validation**: Increments should not span unrelated primary owners without documentation in **maintainer-map.md**.

---

## Entity: Integration line

| Field | Description |
|-------|-------------|
| `name` | Branch (or equivalent) — **`main`** per `plan.md` unless updated. |
| `role` | Merge target for FR-013/FR-014 counting. |

**Relationships**: All **Refactoring increments** in the wave merge **to** this line.

---

## Entity: Manual regression checklist (authoritative)

| Field | Description |
|-------|-------------|
| `path` | `specs/013-refactor-approach/manual-regression-checklist.md` (relative to repository root) |
| `authority` | Full checklist text **in-repo** (FR-020); `plan.md` records path. |

**Relationships**: Referenced by increments when **FR-013** mandatory manual regression applies.

---

## Entity: Primary maintainer document

| Field | Description |
|-------|-------------|
| `path` | `specs/013-refactor-approach/maintainer-map.md` (relative to repository root) |
| `contents` | Capability boundaries + **increment map** + SC-002/SC-004 notes as needed (FR-007, FR-017). |

**Relationships**: Subordinate **optional** addenda must link from this document (FR-017).

---

## Entity: SC-002 defect record (logical)

| Field | Description |
|-------|-------------|
| `source` | Primary: **GitHub Issues** (FR-023). |
| `classification` | Recall/search–related per rules in `research.md` / `maintainer-map.md`. |
| `dedup_key` | Issue number after merge rules applied. |

**Relationships**: Aggregated for trend vs **baseline window** (FR-016).

---

## State transitions

- **Increment**: `planned` → `in review` → `merged to integration line` (with gates satisfied).
- **First wave**: `open` → `complete` when all six capability areas have ≥1 merged increment (FR-014).

---

## Validation rules (from requirements)

- **FR-013**: Direct change to recall/search/admin HTTP paths → manual checklist **before** merge (unless FR-019/FR-026 exemption).
- **FR-026**: Documentation-only / qualifying type-only / emit-equivalent → no **mandatory** manual gate at program level.
- **Indirect-only** changes in embedding/scheduling/etc. → **no** mandatory FR-013 manual gate by indirect effect alone.
