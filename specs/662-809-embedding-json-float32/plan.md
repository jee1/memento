# Implementation Plan: 임베딩 JSON → Float32 BLOB (#809)

**Branch**: `feature/perf-embedding-json-float32-233mb-45mb` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/662-809-embedding-json-float32/spec.md`

## Summary

`memory_embedding.embedding`을 JSON 텍스트 배열에서 **float32 little-endian BLOB**으로 전환한다. 기존 값은 재임베딩 없이 JSON 파싱→BLOB 재인코딩하고, #755 패턴(단일 `db.transaction()`)으로 원자성을 보장한다. 트랜잭션 성공 후 vec 테이블 전량 재적재와 `recreateVecTriggers`를 트랜잭션 **밖**에서 수행한다. `vec-schema.ts`의 `json_extract` 의존을 제거하고 읽기·쓰기 hot path 전반에서 JSON.parse/stringify를 BLOB codec으로 교체한다. MCP/API 공개 계약은 변경하지 않는다.

## Technical Context

**Language/Version**: TypeScript 5.x (ES modules), Node.js 24+
**Primary Dependencies**: better-sqlite3, sqlite-vec (vec0, `distance_metric=cosine`)
**Storage**: SQLite — `memory_embedding.embedding` TEXT(JSON) → BLOB(float32 LE). `memory_item_vec_*` 가상 테이블은 BLOB 입력 수용(041 선례)
**Testing**: Vitest (`npm test`), 도메인·migration integration spec, vec-schema.spec.ts 정합
**Target Platform**: Node.js 서버(MCP stdio/HTTP admin), Linux/macOS
**Project Type**: npm workspaces 모노레포 — 주 변경 `packages/memento-core`, admin read adapter `packages/memento-server`
**Performance Goals**: recall p95 ≤180ms 또는 baseline 대비 ≥10% 개선; `memory_embedding` dbstat <60MB, 전체 DB <300MB (VACUUM 후)
**Constraints**: big-bang cutover( dual-read 없음), NaN/Inf·차원 불일치 시 전체 rollback, startup-only migrate(FR-022), Constitution II MCP 계약 불변
**Scale/Scope**: 격리 후 baseline ≈4,580행·38MB embedding 테이블. 프로덕션 코드 ~15 파일 + migration 043 + schema.sql + 테스트 fixture 다수

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | 스키마·codec·migration·vec trigger 각각 실패 검증 선행. #755 atomicity failure injection 포함 |
| Backward compatibility (MCP/API) | II (MUST) | PASS | recall/remember 응답 스키마 불변(FR-014). Admin embedding map HTTP 형식 불변, 내부 adapter만 변경(FR-023) |
| Schema + migration + types sync | III (MUST) | PASS | migration 043, schema.sql, migrate.ts, vec-schema.ts, TypeScript row types 동시 갱신(FR-013) |
| Quality gates + graphify | IV (MUST) | PASS | lint/type-check/test + graphify 재빌드(프로덕션 코드 변경) |
| Observability / graceful degradation | V (SHOULD) | PASS | 마이그레이션 skip/rollback 건수 structured log; 실패 시 JSON live 테이블 보존 |
| Additional Constraints | Additional | PASS | Node 24+, npm workspaces, 합성 fixture만, 라이브 DB 미커밋 |

## Project Structure

### Documentation (this feature)

```text
specs/662-809-embedding-json-float32/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── embedding-storage-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit.superspec.tasks 산출물
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── shared/utils/
│   └── embedding-serialization.ts          # 신설: JSON↔BLOB codec, NaN/Inf/dim 검증
├── infrastructure/database/sqlite/
│   ├── schema.sql                          # embedding BLOB, vec trigger (no json_extract)
│   ├── migrate.ts                          # rebuild 경로 BLOB 정렬
│   ├── vec-schema.ts                       # buildInsertStatements, repopulateVecTable
│   └── migration/migrations/
│       └── 043-embedding-float32-blob.ts   # 신설: JSON→BLOB atomic migration
├── domains/memory/services/
│   └── memory-embedding-service.ts         # write BLOB, read adapter
├── domains/memory/services/memory-neighbor-service.ts
├── domains/consolidation/repositories/consolidation-repository.ts
├── domains/anchor/services/anchor/anchor-cache-service.ts
└── shared/utils/type-guards.ts

packages/memento-server/src/server/routes/admin/
└── admin-embedding-map-response.ts         # BLOB read adapter

scripts/
├── check-and-fix-trigger.ts                # json_extract 제거 동기화
└── __tests__/fix-migration.integration.spec.ts
```

**Structure Decision**: codec을 `shared/utils/embedding-serialization.ts` 한 곳에 둔다. 도메인(memory, anchor, consolidation)과 infra(vec-schema, migrate)가 공유하며 FR-020 단일 정의를 만족한다. vec DDL·트리거는 기존 `vec-schema.ts` 단일 원본(#713)을 유지한다.

## Phased Implementation Strategy

### Phase A — BLOB codec (동작 추가, migration 전 green baseline)

- `embedding-serialization.ts`: `encodeFloat32Embedding(numbers)`, `decodeFloat32Embedding(blob)`, `migrateJsonEmbeddingToBlob(json)`, `computeL2Norm`, `isNormalizedWithinTolerance(norm, 1e-5)`
- NaN/Inf 거부, dim vs byteLength÷4 검증, empty `[]` → null blob + dim 0
- **요구**: FR-001, FR-018~FR-020 / **판정**: unit spec green

### Phase B — Vec trigger & schema artifacts (infra, migration 선행)

- `vec-schema.ts`: `json_extract(NEW.embedding,'$')` → `NEW.embedding` (insert/update/repopulate)
- `schema.sql`, `init-legacy-schema.ts`, `scripts/check-and-fix-trigger.ts` 동기
- `vec-schema.spec.ts` 갱신 — schema.sql·buildVecTriggerSql 정합
- **요구**: FR-006, FR-016 / **판정**: vec-schema.spec green

### Phase C — Versioned migration 043 (#755 atomic)

- `043-embedding-float32-blob.ts`: detect JSON TEXT → rebuild `memory_embedding__new` with BLOB column
- 트랜잭션 내: vec trigger DROP → create __new → row-wise JSON→BLOB copy (validation) → drop/rename
- normalized 교정(|norm−1|<1e-5), empty `[]` skip 리포트
- 트랜잭션 밖: all vec tables repopulate + `recreateVecTriggers` + optional VACUUM hook point
- failure injection spec (#755 회귀, SC-006)
- **요구**: FR-002~FR-004, FR-015, FR-017, FR-024 / **판정**: migration spec + integration

### Phase D — Write path (US1/US2 선행)

- `memory-embedding-service.ts`: `JSON.stringify` → `encodeFloat32Embedding`; normalized write rule
- **요구**: FR-001, FR-009 / **판정**: memory-embedding-service spec

### Phase E — Read paths (US2/US3)

- type-guards, memory-neighbor-service, consolidation-repository, anchor-cache-service, admin-embedding-map-response → decode helper
- JSON.parse 제거(FR-021); dual-read 없음
- **요구**: FR-005, FR-021, FR-023 / **판정**: 각 spec + admin-embedding-map spec

### Phase F — Search parity & size validation (US1/US2)

- top-10 before/after harness (고정 쿼리·스냅샷)
- `checkVecCardinality` post-migration 0 mismatch (SC-004)
- dbstat size check script or spec assertion (SC-001/002)
- **요구**: FR-007, FR-010~FR-011, SC-001~SC-004

### Phase G — Metadata & polish (US4)

- precision=32, normalized sample audit (SC-008)
- test fixture BLOB migration (FR-025)
- graphify, lint, type-check, full test (SC-007)

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 없음 | — | — |

## Post-Design Constitution Re-check

| Gate | Status | Notes |
|------|--------|-------|
| I Test-First | PASS | Phase A부터 TDD; migration failure injection |
| II MCP/API | PASS | contracts/embedding-storage-contract.md C3 |
| III Schema sync | PASS | 043 + schema.sql + vec-schema + types |
| IV Quality | PASS | tasks Phase Polish |
| V Observability | PASS | migration report logs |
