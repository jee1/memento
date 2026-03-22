# Issue #91 Process Attribute recall 스코어링 — SPEC (구현 반영)

SDD **Specify** 단계 사후 요약. **구현된 코드**를 기준으로 범위·요구사항·수용 기준를 정리한다.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | Process Attribute recall 스코어링 고도화 |
| **문서 유형** | SPECIFY (구현 반영 요약 명세) |
| **날짜** | 2026-02-08 |
| **관련 이슈** | [#91](https://github.com/jee1/memento/issues/91) |
| **설계 문서** | [design.md](./design.md) |
| **구현 계획** | [implementation-plan.md](./implementation-plan.md) |

---

## 1. 범위

### 1.1 In scope (구현됨)

- **DB**: `process_attribute` 테이블(마이그레이션 020) — process_id(PK), topics, workflow_names, skill_names(JSON 배열), created_at, updated_at.
- **리포지토리**: `ProcessAttributeRepository` — getByProcessId(processId), upsert(attr).
- **적합도 계산**: `computeProcessAttributeFit(attr, item)` — ProcessAttribute와 메모리 항목(tags, workflow_name, skill_name) 기반 0~1 점수. attr이 null이면 1(중립).
- **랭킹**: SearchRanking에 `process_attribute_fit` 가중치(θ, 기본 0.1). SearchFeatures.process_attribute_fit 반영. ranking_weights.theta 설정 지원.
- **검색 파이프라인**: HybridSearchEngine에서 filters.process_id가 있으면 ProcessAttributeRepository로 속성 조회 후 normalizeScores에 processAttributes 전달, 각 결과에 process_attribute_fit 주입.
- **recall 도구**: recall MCP 인자 `process_id`를 filters.process_id로 전달하여 검색 시 process-attribute 스코어링 적용.

### 1.2 Out of scope (현재 미구현·선택)

- process_attribute 등록용 MCP 도구(process_attribute_upsert 등). 저장은 리포지토리 upsert로 가능하나 전용 도구는 미노출.

---

## 2. 요구사항 요약

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-91-1 | process_attribute 테이블이 process_id별 topics, workflow_names, skill_names를 저장한다. | 마이그레이션 020 적용 시 테이블·컬럼 존재. |
| REQ-91-2 | ProcessAttributeRepository가 getByProcessId, upsert를 제공한다. | 기존 process-attribute-repository.spec.ts 통과. |
| REQ-91-3 | recall 시 filters.process_id가 있으면 해당 process의 속성으로 검색 결과에 process_attribute_fit가 반영된다. | HybridSearchEngine에서 process_id 시 ProcessAttributeRepository 조회, computeProcessAttributeFit 적용, SearchRanking 가중치(θ) 반영. |
| REQ-91-4 | process_attribute_fit 가중치(θ)는 설정(ranking_weights.theta)으로 지정 가능하며 기본값은 0.1이다. | constants.ts·ranking-weights-loader.ts에 theta 매핑, 기본 0.1. |
| REQ-91-5 | recall 도구는 process_id 인자를 받아 filters.process_id로 검색에 전달한다. | recall-tool에서 process_id → filters 전달, 검색 시 적용. |

---

## 3. 수용 기준 (검증)

- `npm test` 시 020-process-attribute-table.spec.ts, process-attribute-repository.spec.ts, process-attribute-fit.spec.ts, search-ranking.spec.ts(Process Attribute 적합도), hybrid-search-engine·recall-tool 관련 테스트 통과.
- E2E: process_attribute에 데이터 존재 시 recall(process_id 지정) 결과에서 해당 process 속성과 맞는 메모리가 더 높은 점수로 상위 노출.
