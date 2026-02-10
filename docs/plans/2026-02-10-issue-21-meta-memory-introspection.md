# [Issue #21] 메타-기억(Meta-Memory) 기반 자기 성찰 기능 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI 에이전트가 M1(기억 저장소)을 스캔해 신뢰도 평가·실패 패턴 인식·정보 부족(Gap) 식별을 수행하는 M2(메타-기억) 모듈을 구현한다.

**Architecture:** 기존 `meta_memory_stats`·`MetaMemoryService`(recall 통계)를 활용하고, M2 전용 도메인 서비스(`introspection` 또는 `memory` 내)에서 주기적 스캔·요약·플래그를 수행한다. 백그라운드 실행은 `BatchScheduler`에 새 job으로 등록한다. 실패 회피 규칙은 별도 테이블에 저장하고(선택), Gap 분석은 workflow_name/skill_name/type별 집계로 제공한다.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, 기존 BatchScheduler·MetaMemoryService.

---

## 사전 조건

- `meta_memory_stats`(마이그레이션 011) 및 `MetaMemoryService`가 이미 recall 성공/실패·avg_confidence를 수집함.
- `memory_item`에 `last_accessed`, `workflow_name`, `skill_name`, `type` 등 존재.

---

## Task 1: 실패 회피 규칙 저장 스키마 (선택·Phase B)

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/018-failure-avoidance-rules.sql`
- Modify: `src/infrastructure/database/database/schema.sql` (테이블 정의 반영)

**Step 1: Write the failing test**

테스트는 마이그레이션 적용 후 테이블 존재 여부를 검증하는 통합 테스트 또는 스키마 로드 테스트.

**Step 2: Run test to verify it fails**

`npm test -- --run src/infrastructure/database` (해당 테스트 경로).

**Step 3: Migration 018 작성**

- `failure_avoidance_rule` 테이블: id, agent_id, summary TEXT, pattern_context TEXT (JSON), source_memory_ids TEXT (JSON 배열), created_at, updated_at.

**Step 4: Run migration and test**

`npm run db:migrate`, 테스트 재실행.

**Step 5: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/018-failure-avoidance-rules.sql
git commit -m "chore(db): add failure_avoidance_rule table for issue #21"
```

---

## Task 2: M2 자기성찰 스캔 서비스 (핵심)

**Files:**
- Create: `src/domains/memory/services/meta-memory-introspection-service.ts`
- Create: `src/domains/memory/services/__tests__/meta-memory-introspection-service.spec.ts`

**Step 1: Write the failing test**

- Given: DB에 memory_item + meta_memory_stats 레코드 존재 (낮은 avg_confidence, 높은 failure_count).
- When: `MetaMemoryIntrospectionService.runScan(db, { agentId: 'default' })` 호출.
- Then: 반환 객체에 `lowConfidenceMemoryIds`, `highFailureMemoryIds`, `summary`(요약 문자열) 포함.

**Step 2: Run test to verify it fails**

`npm test -- --run src/domains/memory/services/__tests__/meta-memory-introspection-service.spec.ts`

Expected: FAIL (service or method not defined).

**Step 3: Write minimal implementation**

- `MetaMemoryIntrospectionService` 클래스, `runScan(db, options)` 메서드.
- `meta_memory_stats`와 `memory_item` JOIN하여 avg_confidence < 임계값(예: 0.5)인 id 목록, failure_count > 임계값(예: 2)인 id 목록 조회.
- 요약 문자열 생성 (예: "저신뢰 메모리 N건, 고실패 메모리 M건").

**Step 4: Run test to verify it passes**

`npm test -- --run src/domains/memory/services/__tests__/meta-memory-introspection-service.spec.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/domains/memory/services/meta-memory-introspection-service.ts src/domains/memory/services/__tests__/meta-memory-introspection-service.spec.ts
git commit -m "feat(memory): add MetaMemoryIntrospectionService for issue #21"
```

---

## Task 3: memory_item.last_accessed 동기화 (선택)

**Files:**
- Modify: `src/domains/memory/services/meta-memory-introspection-service.ts`

**Step 1: Write the failing test**

- Given: meta_memory_stats에 last_recalled_at이 있고 memory_item.last_accessed가 더 오래됨 또는 NULL.
- When: runScan 시 syncLastAccessed 옵션 true.
- Then: 해당 memory_item의 last_accessed가 last_recalled_at으로 업데이트됨.

**Step 2–5:** TDD 사이클 (실패 확인 → 최소 구현 → 통과 → 커밋).

```bash
git commit -m "feat(memory): sync memory_item.last_accessed from meta_memory_stats in M2 scan"
```

---

## Task 4: Gap 분석 (workflow/skill/type별 성공률)

**Files:**
- Modify: `src/domains/memory/services/meta-memory-introspection-service.ts`
- Modify: `src/domains/memory/services/__tests__/meta-memory-introspection-service.spec.ts`

**Step 1: Write the failing test**

- Given: memory_item에 workflow_name/skill_name/type 다양하게 있고 meta_memory_stats에 success_count, failure_count 존재.
- When: runScan 호출 (또는 getGapAnalysis(db) 별도 메서드).
- Then: 반환에 workflow_name/skill_name/type별 success_rate 또는 "부족" 플래그 목록 포함.

**Step 2–5:** TDD 사이클.

```bash
git commit -m "feat(memory): add gap analysis by workflow/skill/type for issue #21"
```

---

## Task 5: BatchScheduler에 M2 스캔 job 등록

**Files:**
- Modify: `src/infrastructure/scheduler/batch-scheduler.ts`
- Modify: `src/infrastructure/scheduler/batch-scheduler.spec.ts` (필요 시)

**Step 1: Write the failing test**

- Given: BatchScheduler가 start된 상태, DB 연결됨.
- When: `runJob('meta_memory_introspection')` 호출 (또는 등록된 job 이름).
- Then: BatchJobResult.success true, processed >= 0.

**Step 2: Run test to verify it fails**

Expected: FAIL (job not found or not registered).

**Step 3: Implementation**

- BatchJobConfig에 `metaMemoryIntrospectionInterval` (기본: 6시간) 추가.
- `runMetaMemoryIntrospection()` 메서드: MetaMemoryIntrospectionService.runScan(db) 호출, 결과 로깅.
- `scheduleJob('meta_memory_introspection', interval, runMetaMemoryIntrospection, priority)`.
- `start()` 내에서 scheduleJob 호출 추가.
- Bootstrap에서 BatchScheduler에 MetaMemoryIntrospectionService 전달할 필요 없이, runScan 내부에서 db만 사용 가능 (서비스는 runScan 시 db 받음).

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(scheduler): add meta_memory_introspection job for issue #21"
```

---

## Task 6: MCP/HTTP 도구 노출 (선택)

**Files:**
- Create: `src/domains/monitoring/tools/get-introspection-summary-tool.ts` (또는 memory 도메인)
- Modify: 도구 등록부 (server bootstrap 또는 라우트)

**Step 1: Write the failing test**

- Given: context에 db와 MetaMemoryIntrospectionService(또는 runScan 호출 가능한 수단) 있음.
- When: get_introspection_summary 도구 호출.
- Then: lowConfidenceMemoryIds, highFailureMemoryIds, summary 등 반환.

**Step 2–5:** TDD 후 구현 및 등록.

```bash
git commit -m "feat(tools): add get_introspection_summary tool for issue #21"
```

---

## 실행 순서 요약

1. Task 2 (M2 스캔 서비스) — 필수.
2. Task 5 (스케줄러 연동) — 필수.
3. Task 3, 4, 6 — 선택(시간 허용 시).
4. Task 1 (실패 회피 규칙 테이블) — LLM 추출 구현 시 필요.

---

## 검증

- `npm run lint`, `npm run type-check`, `npm test` 통과.
- 수동: 서버 기동 후 admin 또는 스케줄러 상태에서 meta_memory_introspection job 존재 확인.

---

## 참고

- 이슈: https://github.com/jee1/memento/issues/21
- 기존 메타 통계: `meta_memory_stats`, `MetaMemoryService`, `get_meta_memory_stats` 도구.
- 우선순위 문서: `docs/plans/2026-02-07-issue-priority-review.md` (Tier 4).
