# [Issue #21] 메타-기억(Meta-Memory) 기반 자기 성찰 기능 구현 계획

> **구현 반영 (현재 코드 기준):** Task 2(M2 스캔 서비스), Task 5(BatchScheduler job) **완료**. Task 1(실패 회피 규칙), Task 3(last_accessed 동기화), Task 4(Gap 분석), Task 6(get_introspection_summary 도구)는 **미구현·선택**으로 둠.

**Goal:** AI 에이전트가 M1(기억 저장소)을 스캔해 신뢰도 평가·실패 패턴 인식·정보 부족(Gap) 식별을 수행하는 M2(메타-기억) 모듈을 구현한다.

**Architecture:** 기존 `meta_memory_stats`·`MetaMemoryService`(recall 통계)를 활용하고, M2 전용 도메인 서비스(`introspection` 또는 `memory` 내)에서 주기적 스캔·요약·플래그를 수행한다. 백그라운드 실행은 `BatchScheduler`에 새 job으로 등록한다. 실패 회피 규칙은 별도 테이블에 저장하고(선택), Gap 분석은 workflow_name/skill_name/type별 집계로 제공한다.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, 기존 BatchScheduler·MetaMemoryService.

---

## 사전 조건

- `meta_memory_stats`(마이그레이션 011) 및 `MetaMemoryService`가 이미 recall 성공/실패·avg_confidence를 수집함.
- `memory_item`에 `last_accessed`, `workflow_name`, `skill_name`, `type` 등 존재.

---

## Task 1: 실패 회피 규칙 저장 스키마 (선택·Phase B) — 미구현

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/018-failure-avoidance-rules.sql`
- Modify: `src/infrastructure/database/database/schema.sql` (테이블 정의 반영)

(계획 내용 유지. LLM 추출 구현 시 필요.)

---

## Task 2: M2 자기성찰 스캔 서비스 (핵심) — ✅ 구현 완료

**Files:**
- `src/domains/memory/services/meta-memory-introspection-service.ts`
- `src/domains/memory/services/__tests__/meta-memory-introspection-service.spec.ts`

**구현 내용:** `MetaMemoryIntrospectionService.runScan(db, options)` — 저신뢰/고실패 메모리 ID 목록 및 요약 문자열 반환. 옵션: lowConfidenceThreshold(기본 0.5), highFailureCountThreshold(기본 2), limit(기본 1000).

---

## Task 3: memory_item.last_accessed 동기화 (선택) — 미구현

(계획 내용 생략. 필요 시 implementation-plan 원본 참조.)

---

## Task 4: Gap 분석 (workflow/skill/type별 성공률) — 미구현

(계획 내용 생략.)

---

## Task 5: BatchScheduler에 M2 스캔 job 등록 — ✅ 구현 완료

**구현 내용:** `meta_memory_introspection` job 등록, `metaMemoryIntrospectionInterval`(기본 6시간), `runMetaMemoryIntrospection()` → `MetaMemoryIntrospectionService.runScan(this.db, {})` 호출.

---

## Task 6: MCP/HTTP 도구 노출 (선택) — 미구현

(계획 내용 생략. get_introspection_summary 도구 미노출.)

---

## 실행 순서 요약

1. ~~Task 2 (M2 스캔 서비스)~~ — 완료.
2. ~~Task 5 (스케줄러 연동)~~ — 완료.
3. Task 3, 4, 6 — 선택(시간 허용 시).
4. Task 1 (실패 회피 규칙 테이블) — LLM 추출 구현 시 필요.

---

## 검증

- `npm run lint`, `npm run type-check`, `npm test` 통과.
- 수동: 서버 기동 후 admin 또는 스케줄러 상태에서 meta_memory_introspection job 존재 확인.

---

## 참고

- 이슈: https://github.com/jee1/memento/issues/21
- 명세(구현 반영): [spec.md](./spec.md)
- 기존 메타 통계: `meta_memory_stats`, `MetaMemoryService`, `get_meta_memory_stats` 도구.
