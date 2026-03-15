# [Issue #21] 메타-기억(Meta-Memory) 기반 자기 성찰 — Design

**Goal:** AI 에이전트가 M1(기억 저장소)을 스캔해 신뢰도 평가·실패 패턴 인식(저신뢰/고실패 메모리 식별)을 수행하는 M2(메타-기억) 모듈을 구현한다.

**Architecture:** 기존 `meta_memory_stats`·`MetaMemoryService`(recall 통계)를 활용하고, M2 전용 도메인 서비스(`MetaMemoryIntrospectionService`)에서 주기적 스캔·요약을 수행한다. 백그라운드 실행은 `BatchScheduler`에 `meta_memory_introspection` job으로 등록한다.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, 기존 BatchScheduler·MetaMemoryService.

---

## 사전 조건

- `meta_memory_stats`(마이그레이션 011) 및 `MetaMemoryService`가 이미 recall 성공/실패·avg_confidence를 수집함.
- `memory_item`에 `last_accessed`, `workflow_name`, `skill_name`, `type` 등 존재.

---

## 구현 범위 (현재 코드 기준)

- **구현됨**: M2 스캔 서비스(`MetaMemoryIntrospectionService.runScan`), BatchScheduler job 등록(기본 6시간 주기), 저신뢰/고실패 메모리 ID 목록 및 요약 문자열 반환.
- **미구현(선택)**: 실패 회피 규칙 테이블(Phase B), `memory_item.last_accessed` 동기화, Gap 분석(workflow/skill/type별), MCP/HTTP 도구 `get_introspection_summary` 노출.

---

## Phase B (SDD, 2026-03-15)

**목표:** 에이전트가 기존 도구 응답으로 “기억 품질 시그널”을 받고, 상세 요약 도구를 호출하며, (선택) 실패 회피 규칙을 Memento에 저장·조회할 수 있게 한다.

**아키텍처 요약:**

- **캐시**: `meta_memory_introspection` job 실행 시 `runScan` 결과를 프로세스 내 캐시에 저장. hint·get_introspection_summary는 이 캐시만 참조(실시간 runScan 없음).
- **introspection_hint**: `recall`·`get_meta_memory_stats` 응답에, 저신뢰 또는 고실패가 1건 이상일 때만 `introspection_hint`(summary, low_confidence_count, high_failure_count, scanned_at) 포함.
- **get_introspection_summary**: 신규 MCP/HTTP 도구. 캐시에서 최근 스캔 결과를 읽어 요약·ID 목록 반환.
- **실패 회피 규칙(선택)**: Memento가 규칙 저장·조회 담당. 추출(LLM 요약)은 외부, 저장·조회는 Memento.

**산출물:** [requirements.md](./requirements.md), [spec-phase-b.md](./spec-phase-b.md), [structure.md](./structure.md), [tech.md](./tech.md), [product.md](./product.md), [tasks.md](./tasks.md).

---

## 참고

- 이슈: https://github.com/jee1/memento/issues/21
- 기존 메타 통계: `meta_memory_stats`, `MetaMemoryService`, `get_meta_memory_stats` 도구.
