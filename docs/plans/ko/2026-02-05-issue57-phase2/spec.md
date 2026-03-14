# Issue #57 Phase 2 — SPEC 요약 (구현 반영)

SDD **Specify** 단계 사후 요약. **로드맵·구현 계획·코드**를 기준으로 Phase 2 범위·요구사항·수용 기준를 정리한다.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | Issue #57 Phase 2 (Procedural Memory Phase 2) |
| **문서 유형** | SPECIFY (요약 명세) |
| **날짜** | 2026-02-05 |
| **관련 이슈** | [#57](https://github.com/jee1/memento/issues/57) |
| **로드맵** | [roadmap.md](./roadmap.md) |
| **설계 개요** | [design.md](./design.md) |
| **구현 계획** | [implementation-plan.md](./implementation-plan.md) |

---

## 1. 범위

Phase 2는 4단계(A→C→B→D)로 구성된다. A·C는 별도 기능 폴더에, B·D는 본 폴더의 설계·구현 계획으로 관리한다.

| 단계 | 항목 | 구현 상태 | 문서 위치 |
|------|------|-----------|-----------|
| A | 고급 버전 관리 | 별도 설계·이관됨 | [procedural-version-management](../2026-02-05-procedural-version-management/) |
| C | remember_procedure 툴 | 완료 | [remember-procedure](../2026-02-05-remember-procedure/) |
| B | 성능 최적화 (인덱스 014, recall 프로파일링) | 구현 완료 | [design-b-performance.md](./design-b-performance.md), implementation-plan Part 1 |
| D | 다중 에이전트 (owner_id 015, recall/remember 필터) | 구현 완료 | [design-d-multi-agent.md](./design-d-multi-agent.md), implementation-plan Part 2 |

---

## 2. 요구사항 요약 (B·D)

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-B1 | procedural 버전 조회용 인덱스(014)가 적용된다. | idx_memory_item_procedural_version_series, idx_memory_item_procedural_version 존재. |
| REQ-B2 | MEMENTO_RECALL_PROFILE=1일 때 recall 소요 시간이 로그에 출력된다. | recall_profile total_ms 등 로깅. |
| REQ-D1 | memory_item에 owner_id 컬럼 및 인덱스(015)가 존재한다. | 마이그레이션 015 적용 시 owner_id, idx_memory_item_owner_id 존재. |
| REQ-D2 | remember/remember_procedure 저장 시 owner_id(파라미터 또는 context.agentId)가 반영된다. | memory_item.owner_id 저장 검증 테스트 통과. |
| REQ-D3 | recall 시 owner_id 필터로 소유자별 결과가 제한된다. | owner_id 필터 테스트 통과, 기존 호출(미지정) 회귀 없음. |

---

## 3. 수용 기준 (검증)

- `npm test` 시 014/015 마이그레이션 스펙, recall-tool(프로파일링·owner_id 필터), remember-tool·remember-procedure-tool(owner_id 저장) 관련 테스트 통과.
- 배포·마이그레이션: [release-checklist.md](./release-checklist.md) 참고.
