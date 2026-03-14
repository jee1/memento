# Issue #21 메타-기억 자기 성찰 — SPEC (구현 반영)

SDD **Specify** 단계 사후 요약. **구현된 코드**를 기준으로 범위·요구사항·수용 기준를 정리한다.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 메타-기억 기반 자기 성찰 (Meta-Memory Introspection, M2) |
| **문서 유형** | SPECIFY (구현 반영 요약 명세) |
| **날짜** | 2026-02-10 |
| **관련 이슈** | [#21](https://github.com/jee1/memento/issues/21) |
| **설계 문서** | [design.md](./design.md) |
| **구현 계획** | [implementation-plan.md](./implementation-plan.md) |

---

## 1. 범위

### 1.1 In scope (구현됨)

- **M2 스캔 서비스**: `MetaMemoryIntrospectionService.runScan(db, options)` — `meta_memory_stats`를 읽어 저신뢰(avg_confidence < 임계값)·고실패(failure_count >= 임계값) 메모리 ID 목록 및 요약 문자열 반환.
- **스캔 옵션**: `agentId`, `lowConfidenceThreshold`(기본 0.5), `highFailureCountThreshold`(기본 2), `limit`(기본 1000, 최대 10000).
- **BatchScheduler 연동**: `meta_memory_introspection` job 등록, `metaMemoryIntrospectionInterval`(기본 6시간) 주기 실행, `runMetaMemoryIntrospection()` → `MetaMemoryIntrospectionService.runScan(db, {})` 호출.

### 1.2 Out of scope (현재 미구현·선택)

- 실패 회피 규칙 저장 스키마(`failure_avoidance_rule` 테이블).
- `memory_item.last_accessed`를 `meta_memory_stats.last_recalled_at`과 동기화.
- Gap 분석(workflow_name/skill_name/type별 성공률·부족 플래그).
- MCP/HTTP 도구 `get_introspection_summary` 노출.

---

## 2. 요구사항 요약

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-21-1 | `MetaMemoryIntrospectionService.runScan(db, options)`가 `MetaMemoryIntrospectionScanResult`를 반환한다. | 반환 객체에 `lowConfidenceMemoryIds`, `highFailureMemoryIds`, `summary` 포함. |
| REQ-21-2 | 저신뢰/고실패 임계값은 옵션으로 지정 가능하며, 미지정 시 기본값(0.5, 2)을 사용한다. | 옵션 검증으로 비정상 값 시 기본값 fallback. |
| REQ-21-3 | BatchScheduler에 `meta_memory_introspection` job이 등록되어 주기적으로 스캔을 실행한다. | `runJob('meta_memory_introspection')` 호출 시 `MetaMemoryIntrospectionService.runScan` 실행, BatchJobResult 반환. |
| REQ-21-4 | 스캔 결과 요약 문자열은 저신뢰·고실패 건수를 포함하고, 플래그가 없을 때 안내 문구를 포함한다. | `summary` 형식: "저신뢰 메모리 N건, 고실패 메모리 M건. …" |

---

## 3. 수용 기준 (검증)

- `npm test` 시 `meta-memory-introspection-service.spec.ts` 및 BatchScheduler 관련 테스트 통과.
- 서버 기동 후 스케줄러 상태에서 `meta_memory_introspection` job 존재 및 주기 실행 확인 가능.
