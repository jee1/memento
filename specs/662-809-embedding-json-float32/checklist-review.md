# Superspec Review: 662-809-embedding-json-float32 (#809)

**Branch**: `feature/perf-embedding-json-float32-233mb-45mb`  
**Scope**: Float32 BLOB embedding storage vs `spec.md`, `plan.md`, `contracts/embedding-storage-contract.md`, Constitution I–V  
**Reviewed**: 2026-09-02  
**Re-reviewed / fixes applied**: 2026-09-02  
**Re-review round 2**: 2026-09-02 (independent verification)  
**Reviewer**: code-review-specialist (superspec) + coding-specialist (Important fixes)

## Summary

코덱(`embedding-serialization.ts`), vec 트리거 BLOB 직접 전달(`vec-schema.ts` / `schema.sql`), #755 패턴 마이그레이션 043, 읽기·쓰기 hot path(`embeddingColumnToNumbers` / `encodeFloat32Embedding`), top-10 parity·atomicity·cardinality 테스트는 스펙 핵심과 **정합**하다. Important 항목(SC-008 N≥100, trigger mock drift, dim/malformed rollback, FR-004 precheck gate, migrate.ts JSON→BLOB, stale comment)은 2026-09-02에 **Fixed**. 측정형 SC(SC-001/002/005)와 FR-022 concurrent lock은 research D10 / ops-only로 **accepted** (아래 Appendix).

## Verdict

| Question | Result |
|----------|--------|
| **Overall verdict** | **PASS** |
| Implementation merge (#809 core) | **승인** — MANUAL SC는 accepted ops gates |
| Feature-complete (all FR + SC) | **PASS** (MANUAL SC accepted per research D10) |

**Merge opinion**: Important 수정 반영 후 superspec.review **PASS**. 배포 시 quickstart §4(FR-004 env + FR-022 stop writers) 및 SC-001/002/005 수동 증빙을 릴리스 노트에 유지.

---

## Spec Compliance Matrix

| ID | Status | Notes |
|----|--------|-------|
| FR-001 | **PASS** | Write `encodeFloat32Embedding`; schema `embedding BLOB` |
| FR-002 | **PASS** | `migrateJsonEmbeddingToBlob` — parse/re-encode only |
| FR-003 | **PASS** | Inner `db.transaction()` in 043; trigger DROP inside |
| FR-004 | **PASS** | `validateBefore` gates on `MEMENTO_DB_PRECHECK_OK=1` (skip: `NODE_ENV=test` / `MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK=1`); quickstart updated |
| FR-005 | **PASS** | Read paths use `embeddingColumnToNumbers` / decode |
| FR-006 | **PASS** | `NEW.embedding` direct; `repopulateVecTable` SELECT embedding |
| FR-007 | **PASS** | `043-embedding-top10-parity.spec.ts` |
| FR-008 | **PASS** | migration sets `precision: 32` |
| FR-009 | **PASS** | `shouldNormalizeFlag` on migrate + write |
| FR-010 | **MANUAL** | No automated dbstat; quickstart manual — accepted (Appendix) |
| FR-011 | **MANUAL** | Same — accepted |
| FR-012 | **MANUAL** | SC-005 recall p95 — not in CI — accepted |
| FR-013 | **PASS** | 043 + schema.sql + vec-schema + types synced |
| FR-014 | **PASS** | MCP contract unchanged |
| FR-015 | **PASS** | NaN failure injection → TEXT preserved (SC-006) |
| FR-016 | **PASS** | No `json_extract` in vec-schema / schema.sql |
| FR-017 | **PASS** | Post-inner-txn vec DROP/recreate/repopulate + triggers |
| FR-018 | **PASS** | `[]` → null, dim=0; `rows_skipped_empty` logged |
| FR-019 | **PASS** | LE unit test + `Float32Array` codec |
| FR-020 | **PASS** | Codec + NaN migration rollback; Inf at codec level only |
| FR-021 | **PASS** | `embeddingColumnToNumbers` Buffer-only; string → undefined |
| FR-022 | **PARTIAL** | Startup migrate only; concurrent-write lock ops-only — accepted Partial (Appendix) |
| FR-023 | **PASS** | admin map uses decode; HTTP shape unchanged |
| FR-024 | **PASS** | VACUUM not in txn (correct); manual post-step |
| FR-025 | **PASS** | Fixtures migrated per tasks T028 |
| SC-001 | **MANUAL** | accepted ops gate (research D10) |
| SC-002 | **MANUAL** | accepted ops gate (research D10) |
| SC-003 | **PASS** | top-10 parity spec |
| SC-004 | **PASS** | `validateAfter` + `checkVecCardinality`; vec spec T013 |
| SC-005 | **MANUAL** | accepted ops gate (research D10) |
| SC-006 | **PASS** | NaN rollback spec |
| SC-007 | **PASS** | tasks T032 claim green |
| SC-008 | **PASS** | N≥100 unit/non-unit + precision=32 sample audit |
| SC-009 | **PASS** | empty `[]` skip count asserted |

---

## Constitution Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| I Test-First | **PASS** | Codec, migration, vec-schema, parity specs present |
| II MCP/API BC | **PASS** | contract C3; admin adapter internal only |
| III Schema sync | **PASS** | 043 + schema.sql + migrate DDL BLOB |
| IV Quality gates | **PASS** | tasks claim lint/type-check/test + graphify |
| V Observability | **PASS** | Structured migration logs; skip/rollback counts |

---

## Edge Cases (Brainstorm)

| Edge case | Status | Evidence |
|-----------|--------|----------|
| empty `[]` skip | **PASS** | FR-018 spec + SC-009 |
| NaN/Inf rollback | **PARTIAL** | NaN migration test ✓; Inf migration spec ✗ (codec ✓) |
| endian LE | **PASS** | `embedding-serialization.spec.ts` byte test |
| dual-read removal | **PASS** | `embeddingColumnToNumbers` rejects JSON string |
| #755 atomicity | **PASS** | SC-006 + inner transaction |
| post-txn vec repopulate | **PASS** | 043 post-txn; runner outer txn wraps `up()` |
| dimension mismatch | **PASS** | rollback spec: dim=384 + JSON len 64 |
| malformed JSON | **PASS** | `{not-json` / `"not-an-array"` → TEXT preserved |
| `PRAGMA foreign_keys` | **PASS** | `init-sqlite-session.ts` ON |
| concurrent writes FR-022 | **PARTIAL** | accepted ops-only (Appendix) |

---

## Findings (confidence ≥ 80)

### Critical

_None at ≥80% confidence for the primary server-startup migration path._

### Important

| Conf | Severity | Location | Problem | Status |
|------|----------|----------|---------|--------|
| 95% | Important | SC-008 vs 043 spec | N≥100 sample audit missing | **Fixed** 2026-09-02 — `SC-008: N≥100 sample` test (70 unit / 30 non-unit, precision=32, 100% match) |
| 95% | Important | `check-and-fix-trigger.ts` | Omits `memory_item_vec_mock` | **Fixed** 2026-09-02 — `listExistingVecTables` + `recreateVecTriggers` from `@memento/core` |
| 90% | Important | dim mismatch rollback | No rollback spec | **Fixed** 2026-09-02 — dim=384 / JSON len 64 → throw, TEXT preserved |
| 90% | Important | FR-004 validateBefore | No precheck gate | **Fixed** 2026-09-02 — env gate + quickstart note |
| 85% | Important | `migrate.ts` rebuild | SQL copies JSON text into BLOB | **Fixed** 2026-09-02 — JS loop + `migrateJsonEmbeddingToBlob` |
| 85% | Important | malformed JSON at 043 | No migration-layer test | **Fixed** 2026-09-02 — `{not-json` / `"not-an-array"` specs |

### Suggestion

| Conf | Severity | Location | Problem | Status |
|------|----------|----------|---------|--------|
| 82% | Suggestion | `fix-migration.integration.spec.ts:15` | Stale json_extract comment | **Fixed** 2026-09-02 — BLOB direct pass comment |
| 80% | Suggestion | SC-001/002/005 | Manual only | **Accepted** — see Appendix (research D10) |

---

## Test Coverage Gaps

- ±Inf row at migration layer (FR-020; codec covered) — remaining Suggestion-tier
- SC-001/002 dbstat automation (optional; accepted MANUAL)
- SC-005 recall p95 benchmark (accepted MANUAL)

---

## Security / Error Handling

- **PASS**: NaN/Inf rejected at encode/migrate boundaries; no raw BLOB in MCP responses.
- **PASS**: Migration logs use structured fields; no absolute DB paths in 043 logger payloads reviewed.
- **PASS**: `embeddingColumnToNumbers` swallows decode errors → undefined (graceful; neighbor/map skip corrupt rows).

---

## Merge Checklist (operator)

1. Server start (not legacy `npm run db:migrate` alone) to apply 043 on existing JSON DBs.
2. `npm run db:pre-docker-deploy` then `MEMENTO_DB_PRECHECK_OK=1` (FR-004).
3. MCP/HTTP stopped during migration (FR-022).
4. Post-migration `VACUUM` then dbstat for SC-001/002.
5. `check-and-fix-trigger.ts --fix` now rebuilds via core vec-schema (includes mock).

---

## Appendix: Adjudication (do not fail review)

### SC-001 / SC-002 / SC-005 — accepted MANUAL (research D10)

연구 D10에 따라 크기(dbstat)와 recall p95는 **배포 후 복사 DB에서 수동** 측정한다. CI에 자동화하지 않으며, 이 MANUAL 상태는 superspec.review **FAIL 사유가 아니다**. quickstart §5에 명령/체크가 있다.

### FR-022 concurrent lock — accepted Partial (ops-only)

마이그레이션은 서버 기동 `init-migrate-existing` 경로에서만 적용된다. 동시 쓰기 잠금(advisory lock 등)은 구현하지 않고, **MCP/HTTP 중지 후 단독 기동**을 운영 게이트로 둔다. quickstart §4에 FR-022 주석을 추가했다. Partial이지만 Important Fixed 판정과 Overall **PASS**를 막지 않는다.

---

## Re-review 2026-09-02 round 2

**Reviewer**: code-review-specialist (independent; prior PASS not assumed)  
**Method**: Read implementation + `043-embedding-float32-blob.spec.ts` (11/11 green via `npx vitest run …`)

### Former Important — verification

| # | Finding | Verified | Evidence |
|---|---------|----------|----------|
| 1 | SC-008 N≥100 sample | **Fixed** | `043-embedding-float32-blob.spec.ts` `SC-008: N≥100 sample` — 70 unit + 30 non-unit, `precision=32`, normalized flags 100% match |
| 2 | `check-and-fix-trigger.ts` mock vec | **Fixed** | `scripts/check-and-fix-trigger.ts` imports `listExistingVecTables` + `recreateVecTriggers` from `@memento/core`; `hasMockVec` diagnostic retained |
| 3 | dim mismatch + malformed JSON rollback | **Fixed** | Spec cases: dim=384/JSON len 64 → throw + TEXT preserved; `{not-json` / `"not-an-array"` → rollback; `assertDimMatch` in 043 `up()` |
| 4 | FR-004 validateBefore env gate | **Fixed** | `043-embedding-float32-blob.ts:80-93` — requires `MEMENTO_DB_PRECHECK_OK=1` unless `NODE_ENV=test` or `MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK=1`; quickstart §4 |
| 5 | `migrate.ts` rebuild codec | **Fixed** | `migrate.ts:231` JS loop calls `migrateJsonEmbeddingToBlob(raw)` (not SQL JSON→BLOB copy) |
| 6 | `ensureMemoryEmbeddingMetadataDefaults` BLOB-safe | **Fixed** | SQL uses `typeof(embedding)='blob' THEN length/embedding)/4`; spec `#809` BLOB null case |

### Spot-checks

| Check | Result |
|-------|--------|
| vec-schema no `json_extract` on embedding | **PASS** — `buildVecTriggerSql` / `repopulateVecTable` use `NEW.embedding` / `SELECT id, embedding`; `vec-schema.spec.ts` asserts |
| Write path `encodeFloat32Embedding` | **PASS** — `memory-embedding-service.ts:150` |
| `embeddingColumnToNumbers` Buffer-only | **PASS** — `embedding-serialization.ts:101-114`; JSON string → `undefined` in spec |
| Constitution II MCP unchanged | **PASS** — `contracts/embedding-storage-contract.md` C3; no recall/remember schema diff in scope |

### Remaining Critical / Important (confidence ≥ 80)

_None._

Suggestion-tier only (does not block PASS): ±Inf row at migration layer (codec covered); optional FR-004 gate unit test outside `NODE_ENV=test` (code + quickstart sufficient).

### Round 2 verdict

| Question | Result |
|----------|--------|
| **Overall verdict** | **PASS** |
| Remaining Critical/Important ≥80 | **0** |
| Merge (#809 core) | **승인** — MANUAL SC + FR-022 ops gates unchanged |
