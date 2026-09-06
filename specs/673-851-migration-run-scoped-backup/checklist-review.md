# Code Review: Migration Run-Scoped Backup (#851)

**Date**: 2026-09-06 | **Branch**: `feature/chore-db-1-40-1` | **Reviewer**: superspec review  
**Scope**: `specs/673-851-migration-run-scoped-backup` — `migration-runner.ts`, `migration-runner.spec.ts`

## Verdict: **PASS**

| Severity | Found | Fixed | Open |
|----------|-------|-------|------|
| Critical | 0 | 0 | 0 |
| Important | 1 | 1 | 0 |
| Suggestion | 1 | 0 | 1 |

Focused vitest: **24 passed**. lint 0 errors; type-check pass; graphify rebuilt (6846 nodes).

---

## Important (fixed during review)

### I-1. Batch path skipped `down()` when `backupPath` null (신뢰도 90)

**위치**: `migration-runner.ts` — `autoRollback && backupPath`

**문제**: `runMigrations`가 per-version `createBackup: false`로 호출하면 `backupPath`가 항상 null → FR-006의 `down()`/`removeVersion` auto-path가 배치에서 스킵됨.

**수정**: `if (autoRollback)`로 완화; 수동복구 로그는 `backupPath` 있을 때만.

---

## Suggestion (open)

### S-1. `runMigrations` break uses truthy `options.autoRollback` (신뢰도 82)

**위치**: `runMigrations` — `if (!result.success && options.autoRollback)`

**문제**: `runMigration`은 `autoRollback` 기본 true인데, 배치는 `options.autoRollback`이 undefined면 실패 후에도 다음 버전을 계속 시도(기존 동작).

**권장**: 후속 이슈로 `options.autoRollback ?? true` 정렬 검토. MVP 범위 밖.

---

## Spec compliance

| FR / SC | Status |
|---------|--------|
| FR-001..005 run-scoped counts | PASS (tests) |
| FR-006 rollback without file restore | PASS (+ I-1 fix) |
| FR-007 fail-closed before `up` | PASS |
| FR-008 cleanup ≤1 / run | PASS |
| FR-009 create count === 1 | PASS |
| FR-010 no schema-change-only | PASS (out of MVP) |
| SC-001 N≥5 → 1 create | PASS |
| SC-002 init inherits `runMigrations` | PASS (no API break) |
| SC-003 single `runMigration` | PASS (existing tests) |
| SC-004 mid-batch no restoreBackup | PASS |

## Constitution

| Gate | Status |
|------|--------|
| I Test-first | PASS |
| II Compat | PASS |
| III Schema | N/A (no schema) |
| IV Quality + graphify | PASS |
| V Observability | PASS |

## Checklist

- [x] Acceptance scenarios covered by tests
- [x] Edge: empty list, createBackup false, backup fail, mid-batch fail
- [x] No live `DB_PATH` in tests
- [x] CHANGELOG + AGENTS gotcha
- [x] Critical/Important open = 0
