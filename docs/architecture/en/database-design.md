# Database Design

**Purpose**: Single design specification for the Memento MCP Server SQLite schema: table/column roles, naming rules, indexes/constraints, migration history.

**Note**: The source of truth for executable DDL is `src/infrastructure/database/database/schema.sql` and migration scripts; this document is explanatory.

**Related**: [Migration system guide](../../guides/en/migration-system-guide.md), [DB design consolidation proposal](../../plans/ko/database-design-consolidation-proposal.md), [Full table ERD](../ko/database-erd.md).

---

## 1. Overview

- **Role**: Memento uses an embedded SQLite DB, from M1 personal memory storage to the current schema (MIRIX, relation engine, anchor, embedding, multi-agent, KG Triple).
- **Single-document policy**: Executable schema is defined by `schema.sql` and migrations (002–020). This document is the single reference for design, purpose, and history.
- **Timestamp timezone**: Store times in the DB in **UTC**. Use ISO 8601 with `Z` or SQLite `strftime('%Y-%m-%dT%H:%M:%fZ','now')`. Convert to KST etc. for logs/display as needed.
- **Related docs**:
  - [Migration system guide](../../guides/en/migration-system-guide.md)
  - Schema DDL: `src/infrastructure/database/database/schema.sql`
  - Migrations: `src/infrastructure/database/database/migration/migrations/`
  - Repo guide (DB): `AGENTS.md`

For full sections (concepts, tables, indexes, migration history), see the [Korean version](../ko/database-design.md).
