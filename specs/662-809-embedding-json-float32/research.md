# Phase 0 Research: 임베딩 JSON → Float32 BLOB (#809)

**Date**: 2026-09-01 | **Plan**: [plan.md](./plan.md)

Brainstorm 4세션(Q1~Q12)으로 Technical Context 미결 항목 없음. 아래는 코드 실측 기반 구현 결정.

---

## D1. BLOB codec 위치

**Decision**: `packages/memento-core/src/shared/utils/embedding-serialization.ts` 신설.

**Rationale**: write path(`memory-embedding-service`), read paths(5+ files), migration 043, tests가 동일 규칙(LE float32, NaN/Inf 거부, dim 검증)을 써야 한다. `shared/utils`는 domain↔infra 경계에 적합(#806 `vector-similarity.ts` 선례).

**Alternatives considered**:
- migration 파일에만 인라인 — read/write 경로 중복, FR-020 위반
- `domains/embedding/` — consolidation·anchor가 embedding domain import 추가

---

## D2. sqlite-vec BLOB 입력

**Decision**: vec0 `embedding float[N]` 컬럼에 **BLOB을 직접 INSERT**. 트리거/repopulate SQL: `SELECT NEW.id, NEW.embedding` (json_extract 제거).

**Rationale**: brainstorm Q3. sqlite-vec는 float32 바이트 시퀀스를 수용; JSON 텍스트는 `json_extract` 전용. 041 migration의 repopulate 패턴을 BLOB 컬럼에 맞게 교체.

**확인**: `vec-schema.ts:97` 현재 `json_extract(NEW.embedding, '$')` — 변경 대상 단일 원본.

**Alternatives considered**:
- SQL UDF로 BLOB→JSON 변환 — 불필요 복잡도, 성능 이득 상실
- vec만 JSON 유지 — storage 목표 무효

---

## D3. Migration 배치: versioned 043 vs migrate.ts only

**Decision**: **versioned migration `043-embedding-float32-blob.ts`** + `migrate.ts` rebuild DDL을 BLOB으로 정렬. 감지: `PRAGMA table_info`에서 embedding declared type 또는 샘플 행이 JSON 텍스트(`[` prefix)인 경우 043 실행.

**Rationale**: 기존 DB는 MigrationRunner 경로; greenfield는 schema.sql. #755 패턴은 043 `up()` 내부 `db.transaction()`에 구현. `migrate.ts`의 generic rebuild는 신규 install·legacy column 누락용으로 BLOB 스키마 유지.

**Alternatives considered**:
- migrate.ts만 — 이미 적용된 DB(version > 43) 재실행 경로 불명확
- dual-read rolling — spec Q2에서 기각

---

## D4. Cutover 후처리 순서

**Decision** (Q3, FR-017):

1. `db.transaction()`: trigger DROP → table rebuild/copy → rename
2. **트랜잭션 밖**: 각 `VEC_TABLES`에 대해 DROP+CREATE 또는 TRUNCATE + `repopulateVecTable`
3. `recreateVecTriggers(db, listExistingVecTables(db))`
4. (운영/검증) `VACUUM` → dbstat 측정

**Rationale**: #755 — 트랜잭션 중 트리거 OFF이므로 vec stale; 041-vec-cosine-metric.ts가 동일 post-txn repopulate+recreate 패턴.

---

## D5. empty `[]` 행

**Decision**: copy 시 JSON `[]` → `embedding` NULL 또는 empty BLOB 금지; **dim=0, dimensions=0** 유지, vec predicate `dimensions = N`(N>0)로 자동 제외. skip count 로그.

**Rationale**: `fix-migration.integration.spec.ts` — vec trigger는 빈 JSON 배열 불가. spec FR-018, SC-009.

---

## D6. normalized 임계값

**Decision**: **|L2 norm − 1.0| < 1e−5** → `normalized=1`, else 0. migration copy와 insert path 공통 helper.

**Rationale**: brainstorm Q5; float32 재인코딩 후 norm drift 최소, 1e−5는 unit test 고정 가능.

---

## D7. Read path 목록 (JSON.parse 제거)

**Decision**: 다음 생산 코드 경로를 `decodeFloat32Embedding`으로 교체:

| File | Usage |
|------|-------|
| `shared/utils/type-guards.ts` | `convertMemoryRowToItem` |
| `domains/memory/services/memory-neighbor-service.ts` | neighbor vector load (2 sites) |
| `domains/consolidation/repositories/consolidation-repository.ts` | consolidation vector |
| `domains/anchor/services/anchor/anchor-cache-service.ts` | anchor cache |
| `memento-server/.../admin-embedding-map-response.ts` | admin map |

**Rationale**: grep 실측 6 production files. Tests/fixtures는 FR-025로 별도 갱신.

---

## D8. Write path

**Decision**: `memory-embedding-service.ts:145` `JSON.stringify(storedVector)` → `encodeFloat32Embedding(storedVector)` Buffer를 better-sqlite3에 바인딩.

**Rationale**: 단일 write hot path. `created_by=memory_embedding_service` 유지(#753).

---

## D9. 동시 쓰기 / migrate 타이밍

**Decision**: 043 `validateBefore`에서 migration lock 또는 “embedding format already BLOB” idempotent skip. 운영 문서(quickstart): 배포 전 MCP/HTTP 중지, `db:pre-docker-deploy` 통과 필수.

**Rationale**: FR-022; SQLite 단일 writer + big-bang rebuild는 concurrent write와 양립 어려움.

---

## D10. 성능 gate 측정

**Decision**: 구현 후 동일 fixture DB에서 recall 20회 p95; baseline JSON DB 스냅샷 대비 ≤180ms OR ≥10% 개선. CI는 결정론적 integration만; perf gate는 nightly/manual artifact.

**Rationale**: spec FR-012; 환경 편차로 PR gate에 hard p95 부담 과다.

---

## NEEDS CLARIFICATION Resolution

| Item | Resolution |
|------|------------|
| Vec BLOB compatibility | D2 — direct pass |
| Migration idempotency | D3 — skip if already BLOB |
| Codec location | D1 |
| Post-txn vec refresh | D4 |
| All Q1~Q12 | spec Open Questions table |
