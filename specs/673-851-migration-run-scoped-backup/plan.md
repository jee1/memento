# Implementation Plan: Migration Run-Scoped Backup

**Branch**: `feature/chore-db-1-40-1` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/673-851-migration-run-scoped-backup/spec.md`  
**Issue**: [#851](https://github.com/jee1/memento/issues/851)

## Summary

Stop creating one full DB backup per migration version. Lift backup (+ retention
cleanup) to **`runMigrations` run scope**: one `createBackup` before the first
`up`, then call each `runMigration` with `createBackup: false`. Keep direct
`runMigration(..., { createBackup: true })` as a single-version one-backup path.
No schema change; no restore-from-file wiring.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: `better-sqlite3`, existing `BackupManager` / `MigrationRunner`  
**Storage**: SQLite file DB + `dirname(db)/backups/`  
**Testing**: Vitest (`migration-runner.spec.ts`; temp file DB / spies)  
**Target Platform**: Linux server / Docker  
**Project Type**: `@memento/core` infrastructure  
**Performance Goals**: backup creates per boot ≈ 1 (not ≈ pending version count)  
**Constraints**: fail closed if run backup fails; no live `DB_PATH` in tests  
**Scale/Scope**: ~40 migrations/boot historically; 143–175MB per copy

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED: multi-migration createBackup count before GREEN |
| Backward compatibility | II (MUST) | PASS | Options API unchanged; init still passes `createBackup: true` |
| Schema/migration | III (MUST) | PASS | No schema files; safer migration ops (less write amp) |
| Quality gates + graphify | IV (MUST) | PASS | lint/type-check/focused test + graphify after code |
| Observability / isolation | V (SHOULD) | PASS | Existing backup/cleanup soft-fail logging retained at run scope |
| Additional Constraints | Additional | PASS | Node 24/TS ESM; no new auth; no corpus |

Post-design re-check: unchanged PASS.

## Project Structure

### Documentation (this feature)

```text
specs/673-851-migration-run-scoped-backup/
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
│   └── migration-run-backup.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/memento-core/src/infrastructure/database/sqlite/migration/
├── migration-runner.ts          # runMigrations: one backup; per-version suppress
├── migration-runner.spec.ts     # NEW cases: N migrations → 1 createBackup
├── backup-manager.ts            # unchanged API
├── init-migrate-existing.ts     # inherits via runMigrations (no change required)
└── init-bootstrap-new-db.ts     # inherits via runMigrations (no change required)
```

## Phase Strategy

1. **Foundational**: Document current rollback/backup call graph in research.
2. **US1/US4 [TDD]**: Failing test for `runMigrations` createBackup count === 1.
3. **US2**: Confirm single `runMigration` still creates one when enabled.
4. **US3**: Failure-path assertion (mid-batch) still green with one create.
5. **Implement** `runMigrations` hoist + extract shared backup+cleanup helper if needed.
6. **Polish**: CHANGELOG / optional AGENTS gotcha; quality gates; review.

## Complexity Tracking

None — no constitution violations.

## Execution Strategy

- TDD for create-count regression (mandatory).
- Single-file surgical change preferred (`migration-runner.ts` + spec).
- AUTO-APPROVE phase checkpoints (user Speckit #851 full pipeline).
- No commit/push unless user asks.
