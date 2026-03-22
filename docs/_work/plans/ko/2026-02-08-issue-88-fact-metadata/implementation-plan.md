# Fact 1급 객체화 및 메타데이터 표준화 구현 계획 (Issue #88)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Semantic 메모리의 최소 단위를 Fact로 정규화하고, num_times / last_mentioned_at / source_session_id / confidence 등 표준 메타를 도입해 recall·콘솔리데이션 품질을 높인다.

**Architecture:** memory_item 테이블에 Fact 전용 메타 컬럼을 추가한다. 전용 Fact 테이블을 새로 만들지 않고, type='semantic' 항목에 대해 새 컬럼을 사용한다. 기존 importance = importance_score로 정합 유지. 콘솔리데이션 점수는 이미 memory_item.consolidation_score로 존재하므로 Fact 단위 부착 가능.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, 기존 마이그레이션 패턴(016 등).

---

## Task 1: Migration 017 — Fact 메타 컬럼 추가

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.ts`
- Create: `src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.spec.ts`
- Modify: `src/infrastructure/database/database/schema.sql` (컬럼 및 인덱스 추가)

**Step 1: Write the failing test**

- Given: memory_item 테이블 존재(process_id, session_id 포함)
- When: 017 up 실행
- Then: num_times, last_mentioned_at, source_session_id, confidence 컬럼 및 인덱스(필요 시) 존재
- When: down 실행
- Then: 해당 컬럼/인덱스 제거

`017-fact-metadata-fields.spec.ts`에 validateBefore / up / validateAfter / down 시나리오 테스트 작성.

**Step 2: Run test to verify it fails**

```bash
npm test -- src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.spec.ts -v
```

Expected: FAIL (migration class / file not found or tests fail).

**Step 3: Write minimal implementation**

- `017-fact-metadata-fields.ts`: Migration 클래스
  - version = '17.0', name = 'fact-metadata-fields'
  - up: ALTER TABLE memory_item ADD COLUMN num_times INTEGER NOT NULL DEFAULT 1; ADD COLUMN last_mentioned_at TIMESTAMP; ADD COLUMN source_session_id TEXT; ADD COLUMN confidence REAL;
  - 인덱스: idx_memory_item_last_mentioned_at (last_mentioned_at), idx_memory_item_num_times (num_times) — recall 가중용
  - down: DROP INDEX, DROP COLUMN (SQLite 제한 있으면 인덱스만 제거 후 버전 기록 삭제)
- schema.sql에 동일 컬럼·인덱스 반영

**Step 4: Run test to verify it passes**

```bash
npm test -- src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.spec.ts -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.ts \
        src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.spec.ts \
        src/infrastructure/database/database/schema.sql
git commit -m "feat(db): add Fact metadata columns (num_times, last_mentioned_at, source_session_id, confidence) for Issue #88"
```

---

## Task 2: MemoryItem 타입 및 공유 타입 확장

**Files:**
- Modify: `src/shared/types/index.ts` (MemoryItem 인터페이스)
- Modify: `src/tools/types.ts` (remember/recall 도구 스키마에 선택 필드 추가 시)

**Step 1: Write the failing test**

- 도메인 또는 어댑터에서 memory_item row를 MemoryItem으로 매핑할 때 num_times, last_mentioned_at, source_session_id, confidence를 읽는 테스트가 있으면 확장. 없으면 타입만 추가 후 다음 태스크에서 통합 테스트로 검증.

**Step 2–4:** MemoryItem에 필드 추가:

- `num_times?: number;`
- `last_mentioned_at?: Date | string | null;`
- `source_session_id?: string | null;`
- `confidence?: number | null;`

**Step 5: Commit**

```bash
git add src/shared/types/index.ts
git commit -m "feat(types): add Fact metadata fields to MemoryItem (Issue #88)"
```

---

## Task 3: remember 시 Fact 메타 저장

**Files:**
- Modify: `src/domains/memory/tools/remember-tool.ts` (INSERT/UPDATE 시 Fact 메타 컬럼 바인딩)

**Step 1: Write the failing test**

- remember-tool.spec.ts: type='semantic'으로 remember 호출 시 num_times, last_mentioned_at, source_session_id, confidence가 DB에 저장되는지 검증 (Given: DB, When: remember semantic with optional fact meta, Then: SELECT로 컬럼 값 확인).
- 기존 semantic 저장 시 기본값: num_times=1, last_mentioned_at=created_at, source_session_id=session_id, confidence=null 또는 0.5.

**Step 2: Run test to verify it fails**

**Step 3: Implement**

- remember-tool에서 INSERT/UPDATE memory_item 시 새 컬럼 4개 추가. 파라미터로 전달되면 사용, 아니면 기본값.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(remember): persist Fact metadata for semantic memories (Issue #88)"
```

---

## Task 4: recall/검색 시 메타 활용 (num_times · last_mentioned 가중)

**Files:**
- Modify: `src/domains/search/algorithms/search-engine.ts` (또는 스코어링 모듈)
- Test: `src/domains/search/algorithms/__tests__/` 내 관련 스펙

**Step 1: Write the failing test**

- 검색 결과 스코어에 num_times, last_mentioned_at 반영하는 단위/통합 테스트. 예: 동일 유사도일 때 num_times가 큰 항목이 더 위로 오는지.

**Step 2: Run test to verify it fails**

**Step 3: Implement**

- SELECT에 num_times, last_mentioned_at 포함.
- 최종 점수 계산 시 기존 importance/consolidation_score 외에 num_times·last_mentioned_at 보정 적용 (공식은 간단히: 예) boost = 1 + log(1 + num_times) * recency_factor(last_mentioned_at)).

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(search): weight recall by num_times and last_mentioned_at (Issue #88)"
```

---

## Task 5: 문서 및 이슈 체크리스트 정리

**Files:**
- Modify: `docs/plans/2026-02-07-memori-inspired-design.md` (해당 섹션에 “Issue #88 반영 완료” 노트 추가 가능)
- 이슈 #88 본문 체크리스트: Fact 단위 저장 ✓, 표준 메타 ✓, 콘솔리데이션 Fact 단위 ✓, recall 메타 활용 ✓

**Step:** 체크리스트 업데이트 후 필요 시 커밋.

---

## 실행 옵션

**1. Subagent-Driven (이 세션)**  
태스크별로 서브에이전트 디스패치, 태스크 사이에 코드 리뷰.  
→ **REQUIRED SUB-SKILL:** subagent-driven-development

**2. Parallel Session (별도 세션)**  
새 세션에서 executing-plans로 체크포인트 단위 배치 실행.  
→ 새 세션에서 superpowers:executing-plans 사용

어느 방식으로 진행할지 선택하면 된다.
