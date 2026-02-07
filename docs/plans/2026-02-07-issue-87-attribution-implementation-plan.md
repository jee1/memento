# Issue #87 — Attribution (entity/process/session) 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** memory_item에 process_id, session_id를 추가하고, remember/remember_procedure/recall에서 저장·필터를 지원하여 Memori 스타일 Attribution 모델을 도입한다.

**Architecture:** owner_id = entity 유지, process_id·session_id 컬럼 추가. 툴 스키마와 ToolContext에 process_id·session_id 파라미터/필터 추가. 기존 데이터는 NULL 유지(하위 호환).

**Tech Stack:** TypeScript, Vitest, better-sqlite3, 기존 마이그레이션 패턴(015 참고).

---

## Task 1: Migration 016 — process_id, session_id

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/016-memory-item-attribution.ts`
- Create: `src/infrastructure/database/database/migration/migrations/016-memory-item-attribution.spec.ts`

**Step 1:** 실패하는 테스트 작성 (Given/When/Then: up 후 process_id, session_id 컬럼 및 인덱스 존재, down 후 제거).

**Step 2:** 테스트 실행 — 실패 확인.

**Step 3:** 016 마이그레이션 구현 (015 패턴 따름, version 16.0, process_id TEXT NULL, session_id TEXT NULL, idx_memory_item_process_id, idx_memory_item_session_id).

**Step 4:** 테스트 실행 — 통과 확인.

**Step 5:** schema.sql 및 DatabaseUtils 초기 스키마에 process_id, session_id 반영.

**Step 6:** Commit — `feat(db): add process_id and session_id to memory_item (Issue #87)`

---

## Task 2: 공유 타입·ToolContext 확장

**Files:**
- Modify: `src/shared/types/index.ts` — MemoryItem 등에 process_id?, session_id? 추가
- Modify: ToolContext 타입 정의 위치 — process_id?, session_id? 추가

**Step 1:** 타입 확장 (기존 owner_id와 동일한 nullable 패턴).

**Step 2:** Commit — `feat(types): add process_id, session_id to MemoryItem and ToolContext (Issue #87)`

---

## Task 3: remember — process_id, session_id 저장

**Files:**
- Modify: `src/domains/memory/tools/remember-tool.ts` — 스키마·INSERT·context
- Test: `src/domains/memory/tools/__tests__/remember-tool.spec.ts`

**Step 1:** 실패 테스트: remember 호출 시 process_id, session_id 파라미터 또는 context에서 저장되는지.

**Step 2:** remember-tool 스키마에 process_id, session_id optional 추가. INSERT에 컬럼 추가. context.processId, context.sessionId 사용.

**Step 3:** 테스트 통과 후 커밋 — `feat(remember): persist process_id and session_id (Issue #87)`

---

## Task 4: remember_procedure — process_id, session_id 저장

**Files:**
- Modify: `src/domains/memory/tools/remember-procedure-tool.ts`
- Test: `src/domains/memory/tools/__tests__/remember-procedure-tool.spec.ts`

**Step 1:** 실패 테스트 후 구현 (remember와 동일 패턴).

**Step 2:** 커밋 — `feat(remember_procedure): persist process_id and session_id (Issue #87)`

---

## Task 5: recall — process_id, session_id 필터

**Files:**
- Modify: `src/domains/memory/tools/recall-tool.ts` — 파라미터·필터 로직
- Modify: `src/domains/search/algorithms/search-engine.ts` — WHERE 조건에 process_id, session_id 반영(필요 시)
- Test: `src/domains/memory/tools/__tests__/recall-tool.spec.ts`

**Step 1:** 실패 테스트: recall에 process_id/session_id 제공 시 해당 행만 반환.

**Step 2:** recall 스키마에 process_id, session_id (optional, single or array) 추가. 검색/필터 로직에 반영.

**Step 3:** 커밋 — `feat(recall): filter by process_id and session_id (Issue #87)`

---

## Task 6: Anchor 설계 검토 (문서)

**Files:**
- Modify: `docs/plans/2026-02-07-memori-inspired-design.md` 또는 새 절 — 앵커를 process/session 레벨로 매핑하는 옵션 정리.

**설계 노트 (Issue #87 범위 내):**
- 앵커 슬롯(A/B/C)은 현재 `agent_id` per slot으로 관리됨. Memori Attribution 도입 후 **process_id**와의 관계: (1) process_id = agent_id로 동일 값 사용, (2) 앵커 맵 키를 (agent_id, process_id) 또는 (agent_id, session_id)로 확장하는 옵션. 구현은 별도 이슈로 진행 권장.

---

## 완료 기준

- [ ] Migration 016 적용 시 process_id, session_id 컬럼·인덱스 생성/삭제 검증
- [ ] remember/remember_procedure에서 process_id, session_id 저장
- [ ] recall에서 process_id, session_id 필터 적용
- [ ] 기존 호출(파라미터 미지정) 시 동작 회귀 없음
- [ ] `npm test` 통과, `npm run lint` 통과
