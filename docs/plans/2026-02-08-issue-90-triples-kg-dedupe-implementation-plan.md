# Semantic Triples·KG 전용 저장소 및 dedupe 구현 계획 (Issue #90)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (subject, predicate, object) 트리플을 지식그래프용 전용 테이블에 저장하고, 동일 트리플에 대한 정규화·병합(dedupe)을 적용하여 Relation Graph·앵커·검색과 연동한다.

**Architecture:** 기존 `memory_item`의 subject/predicate/object(008)와 `memory_relation`(005)은 유지한다. KG 전용 테이블 `kg_triple`을 새로 두어 정규화된 (subject, predicate, object)당 한 행만 허용(UNIQUE)하고, `representative_memory_id`로 하나의 semantic memory_item을 가리킨다. 트리플 추출·저장 시 `SemanticMemoryUpdateService`에서 먼저 kg_triple에 upsert하고, 이미 있으면 해당 representative memory에만 relation을 추가하고 Fact 메타(num_times 등)를 갱신하며, 없으면 memory_item 생성 후 kg_triple에 연결한다.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, 기존 마이그레이션 패턴(017 등). 기존 도메인: `SemanticMemoryUpdateService`, `RelationGraph`, `TripleExtractionBatchJob` / remember-tool.

---

## 탐색 요약 (코드·스키마)

- **005**: `memory_relation` (source_id, target_id, relation_type, confidence) — memory_item 간 관계. UNIQUE(source_id, target_id, relation_type).
- **008**: `memory_item`에 subject, predicate, object, triple_extracted, triple_extraction_metadata 추가. 트리플은 현재 memory_item 한 행당 하나의 (s,p,o).
- **SemanticMemoryUpdateService**: `createSemanticMemory()`에서 memory_item INSERT (subject, predicate, object). `findDuplicateSemanticMemory()`로 유사/동일 triple 검사 후 업데이트 또는 생성. `memory_relation`에 extracted_from/supported_by 및 confidence 저장.
- **RelationGraph**: memory_relation CRUD, 검색/앵커에서 사용.
- **TripleExtractionBatchJob / remember-tool**: triple 추출 → SemanticMemoryUpdateService 호출.

---

## Task 1: Migration 018 — kg_triple 테이블 추가

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/018-kg-triple-table.ts`
- Create: `src/infrastructure/database/database/migration/migrations/018-kg-triple-table.spec.ts`
- Modify: `src/infrastructure/database/database/schema.sql` (kg_triple 정의 및 인덱스 추가, schema.sql에 memory_relation/kg_triple이 없으면 005·008 스키마는 마이그레이션으로만 존재하므로 kg_triple만 문서화해도 됨 — 팀 규칙에 따라 schema.sql에 반영할지 결정)

**Step 1: Write the failing test**

- Given: memory_item, memory_relation 테이블 존재(017까지 적용된 DB)
- When: 018 up 실행
- Then: `kg_triple` 테이블 존재, 컬럼 id, subject, predicate, object, owner_id, process_id, session_id, representative_memory_id, created_at, UNIQUE(subject, predicate, object) 제약, representative_memory_id → memory_item(id) FK
- When: down 실행
- Then: kg_triple 테이블 및 관련 인덱스 제거

`018-kg-triple-table.spec.ts`에 validateBefore / up / validateAfter / down 시나리오 테스트 작성 (given/when/then 주석 포함).

**Step 2: Run test to verify it fails**

```bash
npm test -- src/infrastructure/database/database/migration/migrations/018-kg-triple-table.spec.ts -v
```

Expected: FAIL (migration class or file not found).

**Step 3: Write minimal implementation**

- `018-kg-triple-table.ts`:
  - version = '18.0', name = 'kg-triple-table'
  - up:
    - `CREATE TABLE IF NOT EXISTS kg_triple (id TEXT PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL, owner_id TEXT NULL, process_id TEXT NULL, session_id TEXT NULL, representative_memory_id TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (representative_memory_id) REFERENCES memory_item(id) ON DELETE SET NULL, UNIQUE(subject, predicate, object));`
    - 인덱스: idx_kg_triple_spo ON kg_triple(subject, predicate, object), idx_kg_triple_representative ON kg_triple(representative_memory_id), idx_kg_triple_owner ON kg_triple(owner_id), idx_kg_triple_process ON kg_triple(process_id)
  - down: DROP INDEX들, DROP TABLE kg_triple
- schema.sql: 프로젝트 규칙에 따라 kg_triple 테이블·인덱스 정의 추가(선택. 마이그레이션만으로 스키마가 구성되면 생략 가능).

**Step 4: Run test to verify it passes**

```bash
npm test -- src/infrastructure/database/database/migration/migrations/018-kg-triple-table.spec.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/018-kg-triple-table.ts \
        src/infrastructure/database/database/migration/migrations/018-kg-triple-table.spec.ts
git commit -m "feat(db): add kg_triple table for KG dedupe (Issue #90)"
```

---

## Task 2: KgTripleRepository (또는 도메인 서비스) — upsert 및 조회

**Files:**
- Create: `src/domains/memory/repositories/kg-triple-repository.ts` (또는 `src/infrastructure/database/repositories/kg-triple-repository.ts` — 팀 레이어 규칙 따름)
- Create: 해당 디렉터리의 `__tests__/kg-triple-repository.spec.ts`

**Step 1: Write the failing test**

- Given: DB with kg_triple table (018 applied)
- When: upsertTriple({ subject, predicate, object, owner_id?, process_id?, session_id?, representative_memory_id? })
- Then: 동일 (s,p,o)로 두 번 호출 시 두 번째는 기존 id 반환, representative_memory_id는 첫 번째로 설정된 값 유지(또는 정책에 따라 갱신)
- When: getBySubjectPredicateObject(s, p, o) 호출
- Then: 해당 행 반환 또는 null

Given/When/Then 구조로 테스트 작성.

**Step 2: Run test to verify it fails**

```bash
npm test -- src/domains/memory/repositories/__tests__/kg-triple-repository.spec.ts -v
```

Expected: FAIL (repository not implemented).

**Step 3: Write minimal implementation**

- `upsertTriple`: INSERT 시 UNIQUE(subject, predicate, object) 위반 시 SELECT로 기존 id 반환. representative_memory_id는 새로 넣을 때만 설정, 기존 행이 있으면 업데이트하지 않거나(또는 정책: 최신로 갱신) 선택.
- `getBySubjectPredicateObject(subject, predicate, object): Promise<KgTripleRow | null>`
- id 생성: generateId() 등 기존 유틸 사용

**Step 4: Run test to verify it passes**

```bash
npm test -- src/domains/memory/repositories/__tests__/kg-triple-repository.spec.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/repositories/kg-triple-repository.ts src/domains/memory/repositories/__tests__/kg-triple-repository.spec.ts
git commit -m "feat(kg): add KgTripleRepository upsert and getBySpo (Issue #90)"
```

---

## Task 3: SemanticMemoryUpdateService — kg_triple 연동 및 dedupe

**Files:**
- Modify: `src/domains/memory/services/semantic-memory/semantic-memory-update-service.ts`
- Modify: `src/domains/memory/services/semantic-memory/semantic-memory-update-service.spec.ts`

**Step 1: Write the failing test**

- Given: DB with memory_item, memory_relation, kg_triple (018)
- When: 동일 (정규화된 subject, predicate, object)로 createSemanticMemory 경로를 두 번 호출(예: processTriples에서 동일 triple 두 개)
- Then: memory_item 행은 하나만 생성되고, 두 번째는 기존 representative memory에 대한 relation만 추가되거나 기존 memory_item id가 재사용됨. kg_triple에는 (s,p,o)당 한 행만 존재.

기존 semantic-memory-update-service.spec.ts에 kg_triple 연동·dedupe 시나리오 추가 (given/when/then).

**Step 2: Run test to verify it fails**

```bash
npm test -- src/domains/memory/services/semantic-memory/semantic-memory-update-service.spec.ts -v
```

Expected: FAIL (두 번째 호출에서 memory_item이 중복 생성되거나 kg_triple 미사용).

**Step 3: Write minimal implementation**

- createSemanticMemory(또는 processTriples 내부) 진입 시: 정규화된 (subject, predicate, object)로 KgTripleRepository.getBySubjectPredicateObject 호출.
- 있으면: representative_memory_id를 반환받아 해당 memory_item에 대해 relation만 추가하고, Fact 메타(num_times, last_mentioned_at 등) 갱신. 새 memory_item 생성하지 않음.
- 없으면: 기존처럼 memory_item INSERT 후 kg_triple INSERT (id, subject, predicate, object, owner_id, process_id, session_id, representative_memory_id = 새 memory id, created_at). 이후 relation 추가.

**Step 4: Run test to verify it passes**

```bash
npm test -- src/domains/memory/services/semantic-memory/semantic-memory-update-service.spec.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/services/semantic-memory/semantic-memory-update-service.ts \
        src/domains/memory/services/semantic-memory/semantic-memory-update-service.spec.ts
git commit -m "feat(memori): integrate kg_triple dedupe in SemanticMemoryUpdateService (Issue #90)"
```

---

## Task 4: Relation Graph·검색 연동 확인 및 문서화

**Files:**
- Modify: `docs/plans/2026-02-08-issue-90-triples-kg-dedupe-implementation-plan.md` (이 문서) 또는 `docs/architecture/` 하위
- Test: 기존 relation-graph, recall, anchor 테스트 재실행

**Step 1: Verify existing behavior**

- **Relation Graph·앵커·검색은 memory_relation 및 memory_item 기준으로 기존과 동일하게 동작하며, dedupe로 representative memory_item만 사용된다.** Relation Graph는 memory_relation 기준으로 동작. kg_triple은 “어떤 memory_item이 이 트리플의 대표인지”만 저장하므로, relation은 계속 source_id/target_id = memory_item.id로 저장됨. dedupe로 인해 동일 triple에 대한 relation이 하나의 representative memory_item으로 모이면 그래프가 단순화됨.
- recall/검색은 memory_item·memory_embedding 기준이므로, representative memory_item 하나만 두면 기존 로직 그대로 동작.

**Step 2: Run relevant tests**

```bash
npm test -- src/domains/relation/ -v
npm test -- src/domains/memory/services/semantic-memory/ -v
npm test -- src/domains/memory/tools/__tests__/remember-tool.spec.ts -v
```

Expected: All PASS.

**Step 3: Document**

- 이 계획서에 “Relation Graph·앵커·검색은 memory_relation 및 memory_item 기준으로 기존과 동일하게 동작하며, dedupe로 representative memory_item만 사용됨” 문구 추가.
- (선택) recall 시 kg_triple 조인으로 triple 기반 보강은 별도 이슈/태스크로 둠.

**Step 4: Commit**

```bash
git add docs/plans/2026-02-08-issue-90-triples-kg-dedupe-implementation-plan.md
git commit -m "docs(issue-90): document Relation Graph and search integration"
```

---

## Task 5: 기존 데이터 마이그레이션 (019 backfill)

**상태:** 구현 완료. 기존 semantic memory_item을 kg_triple에 채워야 동일 (s,p,o) dedupe가 일관되게 동작함.

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/019-backfill-kg-triple-from-memory-item.ts`
- Create: `019-backfill-kg-triple-from-memory-item.spec.ts`

**정책:**
- 018 적용 후 이미 있는 memory_item 중 type='semantic'이고 subject, predicate, object가 모두 NOT NULL인 행을 스캔하여 kg_triple에 INSERT (UNIQUE 유지). 동일 (s,p,o) 여러 개면 created_at ASC 기준 첫 번째를 representative로 사용. id = `triple_backfill_${memory_item.id}`.
- down: memento_schema_version에서 19.0만 제거(비가역, backfill 행은 유지).

---

## 의존성 및 참고

- **#87 (Attribution)**: owner_id, process_id, session_id는 이미 memory_item에 있음(016). kg_triple에 넣으면 triple 단위 귀속 가능.
- **#88 (Fact 메타)**: num_times, last_mentioned_at은 memory_item에 있음(017). 동일 triple 재등장 시 representative memory_item의 해당 필드만 갱신하면 됨.
- **#89 (비동기 Augmentation)**: Triple 추출·저장은 기존 TripleExtractionBatchJob/remember-tool 경로 그대로 사용하며, 내부만 SemanticMemoryUpdateService → kg_triple 연동으로 변경.
- **설계**: `docs/plans/2026-02-07-memori-inspired-design.md` 섹션 4.
- **기존 마이그레이션**: 005(relation), 008(triple on memory_item).

---

## 실행 옵션

계획 작성 완료. 다음 두 가지 중 선택할 수 있다.

1. **Subagent-Driven (이 세션)** — 태스크마다 서브에이전트로 진행, 태스크 간 코드 리뷰·빠른 반복.
2. **Parallel Session (별도 세션)** — 새 세션에서 executing-plans 스킬로 워크트리에서 체크포인트 단위 배치 실행.

원하면 1 또는 2를 지정해 주면 된다.
