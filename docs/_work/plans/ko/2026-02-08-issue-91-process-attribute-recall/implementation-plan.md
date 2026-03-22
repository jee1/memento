# Issue #91: Process Attribute recall 스코어링 고도화 — Implementation Plan

> **구현 반영 (현재 코드 기준):** Task 1~5 **구현 완료**. Task 6(통합 테스트) 일부 반영. process_attribute 등록 MCP 도구는 **미구현·선택**.

**Goal:** process(에이전트)별 주제/속성을 저장하고, recall 시 (query 유사도) × (process-attribute 적합도) 스코어링으로 회수 품질을 높인다.

**Architecture:** process_attribute 전용 테이블로 process_id별 topics/domain 속성(workflow_names, skill_names) 저장. recall 시 filters.process_id가 있으면 해당 process의 속성을 조회하고, 각 검색 결과 메모리와의 적합도(0~1)를 계산해 SearchRanking의 기존 다차원 랭킹에 가중치(θ)로 반영한다. procedural의 workflow_name/skill_name과 네이밍·저장 위치를 맞춘다.

**Tech Stack:** TypeScript, better-sqlite3, 기존 SearchRanking / HybridSearchEngine / recall-tool.

**선행 조건:** #87 Attribution 반영 완료(process_id, session_id 존재). migration 016·019 적용 상태 가정.

---

## Task 1: process_attribute 스키마 및 마이그레이션 — ✅ 구현 완료

(마이그레이션 020, 020-process-attribute-table.spec.ts, schema.sql 반영됨.)

---

## Task 2: ProcessAttribute 타입 및 리포지토리 — ✅ 구현 완료

(ProcessAttribute 인터페이스, ProcessAttributeRepository, process-attribute-repository.spec.ts 반영됨.)

---

## Task 3: Process-attribute 적합도 계산 및 SearchRanking 반영 — ✅ 구현 완료

(process-attribute-fit.ts, SearchFeatures/SearchRankingWeights process_attribute_fit, constants.ts·ranking-weights-loader theta 반영됨.)

---

## Task 4: HybridSearchEngine에서 process_attribute_fit 주입 — ✅ 구현 완료

(HybridSearchEngine에서 filters.process_id 시 ProcessAttributeRepository 조회, normalizeScores에 processAttributes 전달, process_attribute_fit 반영됨.)

---

## Task 5: recall MCP에서 process_id 전달 — ✅ 구현 완료

(recall-tool에서 process_id 인자를 filters.process_id로 전달. process_attribute_upsert 도구는 미구현·선택.)

---

## Task 6: 통합 테스트 및 문서

(recall-tool.spec.ts 등에서 process_attribute 관련 시나리오 일부 반영. 필요 시 E2E 보강.)

---

## 요약 체크리스트

- [x] process_attribute 테이블 (020) 및 스키마
- [x] ProcessAttributeRepository (getByProcessId, upsert)
- [x] computeProcessAttributeFit + SearchRanking process_attribute_fit 가중치
- [x] HybridSearchEngine에서 process_id 시 process attributes 조회 및 normalizeScores에 fit 반영
- [x] recall-tool에서 process_id → filters 전달
- [ ] (선택) process_attribute 등록 MCP 도구
- [x] 통합/E2E 테스트 및 npm test 통과

---

## 참고

- 명세(구현 반영): [spec.md](./spec.md)
- 설계: [design.md](./design.md)
