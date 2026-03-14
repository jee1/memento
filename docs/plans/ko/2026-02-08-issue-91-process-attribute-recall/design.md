# Issue #91: Process Attribute recall 스코어링 고도화 — Design

**Goal:** process(에이전트)별 주제/속성을 저장하고, recall 시 (query 유사도) × (process-attribute 적합도) 스코어링으로 회수 품질을 높인다.

**Architecture:** process_attribute 전용 테이블로 process_id별 topics/domain 속성(workflow_names, skill_names) 저장. recall 시 filters.process_id가 있으면 해당 process의 속성을 조회하고, 각 검색 결과 메모리와의 적합도(0~1)를 계산해 SearchRanking의 기존 다차원 랭킹에 가중치(θ)로 반영한다. procedural의 workflow_name/skill_name과 네이밍·저장 위치를 맞춘다.

**Tech Stack:** TypeScript, better-sqlite3, 기존 SearchRanking / HybridSearchEngine / recall-tool.

**선행 조건:** #87 Attribution 반영 완료(process_id, session_id 존재). migration 016·019 적용 상태 가정.

---

## 구현 범위 (현재 코드 기준)

- **구현됨**: process_attribute 테이블(마이그레이션 020), ProcessAttribute 타입·리포지토리(getByProcessId, upsert), computeProcessAttributeFit, SearchRanking process_attribute_fit 가중치(θ 기본 0.1), HybridSearchEngine에서 process_id 시 속성 조회·normalizeScores에 fit 반영, recall-tool에서 process_id → filters 전달.
- **미구현(선택)**: process_attribute 등록용 MCP 도구(process_attribute_upsert 등).
