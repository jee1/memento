# Architectural Refactoring: Aligning with "Functional Core, Structured Shell"

- **Status**: Draft
- **Date**: 2026-04-23
- **Topic**: Refactoring domain repositories to enforce architectural boundaries and strict typing.

## 1. Context & Purpose
The current codebase has several repository implementations directly within the `domains/` layer, violating the "Functional Core, Structured Shell" principle defined in `DEVELOPMENT_RULES.md`. Specifically, domain repositories are using concrete SQLite logic (`better-sqlite3`) instead of abstract interfaces. This makes the domain logic dependent on infrastructure details.

The goal is to move these implementations to the `infrastructure/` layer and provide clean interfaces in the `domains/` layer, following the established pattern of `core-memory-repository`.

## 2. Scope
Four repositories in `packages/memento-core/src/domains/memory/repositories/` are targeted:
1.  `KnowledgeVaultRepository`
2.  `FeedbackRepository`
3.  `KgTripleRepository`
4.  `ProcessAttributeRepository`

## 3. Proposed Architecture

### Core Pattern
For each repository, we will split it into:
- **Interface (Domain)**: `foo-repository.interface.ts` containing only type definitions and the interface.
- **Implementation (Infrastructure)**: `foo-repository-sqlite.impl.ts` containing the SQLite-specific logic.

### Dependency Injection
Domain services will be updated to depend on the `interface` rather than the `class` implementation.

### Backward Compatibility
Existing repository files will be kept as `@deprecated` re-exports to prevent breaking changes in the short term, facilitating a smooth transition.

## 4. Detailed Refactoring Steps (Sequential)

### Phase 1: Knowledge Vault Repository
1.  Create `knowledge-vault-repository.interface.ts` in `domains/memory/repositories/`.
2.  Create `knowledge-vault-repository-sqlite.impl.ts` in `infrastructure/database/repositories/`.
3.  Update `KnowledgeVaultService` to use the interface.
4.  Update the original `knowledge-vault-repository.ts` to re-export from the interface and mark as `@deprecated`.

### Phase 2: Feedback Repository
(Same steps as Phase 1)

### Phase 3: KgTriple Repository
(Same steps as Phase 1)

### Phase 4: Process Attribute Repository
(Same steps as Phase 1)

## 5. Verification Plan
- **Type Checking**: Run `npm run type-check` after each phase.
- **Unit Testing**: Run existing tests for each repository and service to ensure no behavioral regressions.
- **Linting**: Run `npm run lint` to ensure compliance with coding standards (e.g., no `any` types).

## 6. Strict Typing Alignment
During refactoring, all occurrences of `any` within these repositories and related services will be replaced with specific types or `unknown`.
