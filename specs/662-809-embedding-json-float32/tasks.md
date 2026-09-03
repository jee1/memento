---
description: "Task list for 임베딩 JSON → Float32 BLOB (#809)"
---

# Tasks: 임베딩 JSON → Float32 BLOB (#809)

**Input**: `/specs/662-809-embedding-json-float32/` (plan.md, spec.md, research.md, data-model.md, contracts/)
**Prerequisites**: brainstorm done (4 sessions), plan.md complete
**Branch**: `feature/perf-embedding-json-float32-233mb-45mb`

**Tests**: Constitution I — 모든 구현 Phase는 `[TDD]` RED→GREEN. migration atomicity는 failure injection 필수.

## Format: `[ID] [Markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 다른 파일, 병렬 가능 |
| `[TDD]` | 실패 테스트 → 구현 → green |
| `[REVIEW]` | 다음 Phase 전 리뷰 게이트 |
| `[SUBAGENT]` | 서브에이전트 위임 가능 |

## Global Constraints

- Node.js ≥24, TypeScript ESM, npm workspaces
- MCP recall/remember HTTP 응답 스키마 **불변** (FR-014)
- big-bang cutover, dual-read **금지** (FR-021)
- `#755` 단일 `db.transaction()`; vec repopulate+recreateVecTriggers는 txn **밖**
- 배포 전 `npm run db:pre-docker-deploy`; MCP/HTTP 동시 쓰기 금지 (FR-022)
- `graphify-out/` 커밋 금지
- 검증: `npm test -w packages/memento-core -- <path>`

---

## Phase 1: Setup

**Purpose**: 기준선·브랜치·spec 추적 확인

- [x] **T001** green baseline 확인

```bash
npm ci && npm run build && npm test 2>&1 | tail -30
```

- [x] **T002** [P] spec/plan/contracts 경로 확인 — `specs/662-809-embedding-json-float32/` 전 artifact 존재

**Checkpoint**: CI green, feature branch 확인

---

## Phase 2: Foundational (BLOCKING)

**Purpose**: BLOB codec + vec-schema BLOB trigger — **모든 User Story 선행**

### T003 [TDD] embedding-serialization 유틸

**Files**:
- Create: `packages/memento-core/src/shared/utils/embedding-serialization.ts`
- Create: `packages/memento-core/src/shared/utils/embedding-serialization.spec.ts`

**Produces**:
- `encodeFloat32Embedding(values: number[]): Buffer`
- `decodeFloat32Embedding(blob: Buffer): Float32Array`
- `migrateJsonEmbeddingToBlob(json: string): { blob: Buffer | null; dimensions: number }`
- `computeL2Norm(values: number[] | Float32Array): number`
- `shouldNormalizeFlag(norm: number, tolerance?: number): 0 | 1` (default tolerance 1e-5)

**Tests must cover**: round-trip, LE bytes, NaN/Inf throw, dim mismatch throw, empty `[]` → null blob + dim 0

- [x] Step 1: failing spec
- [x] Step 2: verify RED
- [x] Step 3: minimal implementation
- [x] Step 4: verify GREEN

### T004 [TDD] vec-schema BLOB direct pass

**Files**:
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/vec-schema.ts`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/schema.sql`
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/vec-schema.spec.ts`
- Modify: `scripts/check-and-fix-trigger.ts` (if generated SQL referenced)

**Change**: `json_extract(NEW.embedding, '$')` → `NEW.embedding` in `buildInsertStatements` and `repopulateVecTable`

- [x] Step 1: update vec-schema.spec — assert no `json_extract` in trigger SQL
- [x] Step 2: implement vec-schema + schema.sql sync
- [x] Step 3: green vec-schema.spec

### T005 [P] [TDD] schema.sql embedding column BLOB

**Files**:
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/schema.sql` (`embedding BLOB NOT NULL` or nullable for dim=0 per FR-018)
- Modify: `packages/memento-core/src/infrastructure/database/sqlite/migrate.ts` — `memory_embedding__new` DDL BLOB aligned

**Checkpoint**: T003–T005 green. **User Story 작업 시작 금지 until here.**

---

## Phase 3: User Story 1 — DB 크기·마이그레이션 (P1) 🎯 MVP

**Goal**: JSON→BLOB atomic migration, VACUUM 후 크기 SC-001/002
**Independent Test**: migration spec + dbstat helper on fixture DB

### Tests US1

- [x] **T006** [TDD] [US1] `043-embedding-float32-blob.spec.ts` — happy path JSON→BLOB, row count preserved, precision=32
- [x] **T007** [TDD] [US1] same file — failure injection: NaN row → full rollback, live JSON preserved (SC-006)
- [x] **T008** [TDD] [US1] same file — empty `[]` skip count in report (SC-009)
- [x] **T009** [TDD] [US1] same file — idempotent: second run on BLOB DB no-op

### Implementation US1

- [x] **T010** [US1] Create `043-embedding-float32-blob.ts` — #755 txn, normalized fix, skip logging
- [x] **T011** [US1] Register migration in migration index/runner (follow 042 pattern)
- [x] **T012** [US1] Post-txn: repopulate all vec + `recreateVecTriggers` (041 pattern)
- [x] **T013** [P] [US1] Integration: `vec-cosine-metric.integration.spec.ts` or new spec — BLOB embedding INSERT triggers vec row

**Checkpoint**: US1 migration green; cardinality checkVecCardinality matched

---

## Phase 4: User Story 2 — 검색 결과 동일 (P1)

**Goal**: top-10 100% parity, vec cardinality 0 mismatch (SC-003, SC-004)
**Independent Test**: fixed-query harness spec

### Tests US2

- [x] **T014** [TDD] [US2] top-10 before/after migration harness — mock/minilm fixture, same memory IDs+order
- [x] **T015** [TDD] [US2] multi-provider fixture — minilm + tfidf paths both stable

### Implementation US2

- [x] **T016** [US2] Harness uses migration 043 on copy DB; documents query set in spec artifact dir (synthetic only)
- [x] **T017** [REVIEW] [US2] Manual checklist: run harness, attach aggregate pass/fail to PR (no live DB paths)

**Checkpoint**: SC-003/SC-004 specs green

---

## Phase 5: User Story 3 — read hot path·성능 (P2)

**Goal**: JSON.parse 제거, recall path binary read (FR-005, FR-021)

### Tests US3

- [x] **T018** [P] [TDD] [US3] Update `memory-neighbor-service.spec.ts` — BLOB fixture via encode helper
- [x] **T019** [P] [TDD] [US3] Update `admin-embedding-map-response.spec.ts` — BLOB rows

### Implementation US3

- [x] **T020** [P] [US3] `memory-embedding-service.ts` — write `encodeFloat32Embedding` (FR-001)
- [x] **T021** [P] [US3] `type-guards.ts` — decode BLOB only
- [x] **T022** [P] [US3] `memory-neighbor-service.ts` — decode helper (2 sites)
- [x] **T023** [P] [US3] `consolidation-repository.ts` — decode
- [x] **T024** [P] [US3] `anchor-cache-service.ts` — decode
- [x] **T025** [US3] `admin-embedding-map-response.ts` — decode; HTTP shape unchanged (FR-023)

**Checkpoint**: `grep JSON.parse.*embedding` production src empty

---

## Phase 6: User Story 4 — metadata (P2)

**Goal**: precision=32, normalized |norm−1|<1e−5 (SC-008)

- [x] **T026** [TDD] [US4] migration spec assert: unit vector rows → normalized=1 after 043
- [x] **T027** [US4] write path: `shouldNormalizeFlag` on insert (`memory-embedding-service.ts`)

**Checkpoint**: SC-008 sample N≥100 in spec or integration

---

## Phase 7: Polish & Cross-Cutting

- [x] **T028** [P] [TDD] FR-025 — grep `JSON.stringify` embedding fixtures; migrate to `encodeFloat32Embedding` helper (`consolidation-test-data.ts`, vector-search.repository.spec.ts, etc.)
- [x] **T029** [P] Update `init-legacy-schema.ts` if embedding DDL/triggers duplicated
- [x] **T030** [P] `embedding-migration-service.spec.ts` — BLOB expectations if applicable
- [x] **T031** Run quickstart.md validation steps
- [x] **T032** Quality gates: `npm run lint && npm run type-check && npm test` (SC-007)
- [x] **T033** Graphify rebuild + GRAPH_REPORT.md confirm (Constitution IV)
- [x] **T034** [REVIEW] CHANGELOG entry + issue #809 checklist

---

## Dependencies & Execution Order

```text
Phase 1 → Phase 2 (BLOCKS ALL) → Phase 3 US1 → Phase 4 US2
                                      ↘ Phase 5 US3 (after T010 codec+vec)
                                      ↘ Phase 6 US4 (after T010)
Phase 7 (after US1–US4)
```

| Story | Depends on |
|-------|------------|
| US1 | Phase 2 |
| US2 | US1 (migrated DB) |
| US3 | Phase 2; write path T020 best after T010 |
| US4 | T003, T010 |

### Parallel opportunities

- T004 + T005 after T003
- T021–T024 [P] after T003
- T028 fixture updates [P] anytime after T003

---

## Implementation Strategy

**MVP**: Phase 1–2 + Phase 3 (US1) — shippable migration with vec sync

**Full feature**: + US2 (parity) + US3 (read/write) + US4 (metadata) + Polish

**Subagent dispatch** ([SUBAGENT] candidates):
- T021–T024 read paths (4 files, parallel)
- T028 fixture sweep

---

## Notes

- Migration version: **43.0** (`043-embedding-float32-blob.ts`)
- Perf gate SC-005: manual/nightly artifact per research D10
- No MCP contract changes — verify with existing MCP integration specs smoke
