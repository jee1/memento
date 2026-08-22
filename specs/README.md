# 기능 명세 인덱스

이 파일은 `specs/` 디렉터리의 번호와 상태를 관리하는 진실 공급원입니다. 새 명세 번호는 현재 최대 번호에 1을 더해 배정하며, 삭제되거나 아카이브된 번호를 재사용하지 않습니다.

`001`~`016`의 출시 완료 명세는 불변 기준선 [`44ad88e2583b6486a30ca362729c68ebdeb45702`](https://github.com/jee1/memento/tree/44ad88e2583b6486a30ca362729c68ebdeb45702/specs)과 로컬 `archive/pre-issue-801-cleanup` 브랜치에 보존하고 현재 작업 트리에서는 제거했습니다. `008`과 `046`은 기존에 사용되지 않은 번호이지만 재사용하지 않습니다.

상태 기준:

- `shipped`: 관련 이슈가 닫혔고 구현이 출시된 명세
- `in-flight`: 관련 이슈가 열려 있고 구현 또는 검증이 진행 중인 명세
- `abandoned`: 구현하지 않기로 결정한 명세

| 번호 | 제목 | 상태 | 관련 이슈 |
| --- | --- | --- | --- |
| 001 | [네트워크 서비스 신뢰·보안 강화](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/001-http-trust-security/spec.md) | shipped | — |
| 002 | [Fix CPU Monitoring Bug and Reduce MCP Process Overhead](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/002-fix-mcp-monitoring-overhead/spec.md) | shipped | — |
| 003 | [Recall 검색 품질 개선 — 자연어 쿼리 + TF-IDF Fallback 경고](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/003-recall-sentence-query/spec.md) | shipped | — |
| 004 | [Recall Quality Feedback Loop](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/004-recall-quality-feedback-loop/spec.md) | shipped | — |
| 005 | [Sleep Consolidation](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/005-sleep-consolidation/spec.md) | shipped | — |
| 006 | [Observability & Telemetry for Memory Quality Metrics](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/006-observability-telemetry/spec.md) | shipped | — |
| 007 | [Telemetry CLI & MCP Tool Access](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/007-telemetry-cli-mcp/spec.md) | shipped | — |
| 009 | [기억 관계 그래프 뷰](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/009-memory-graph-view/spec.md) | shipped | [#126](https://github.com/jee1/memento/issues/126) |
| 010 | [Docker HTTP API 엔드포인트 동기화](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/010-fix-docker-api-sync/spec.md) | shipped | — |
| 011 | [Security Hardening for Docker and HTTP Admin](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/011-docker-security-hardening/spec.md) | shipped | — |
| 012 | [Memento 기억 구조화 파이프라인 수정](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/012-fix-memory-structuring/spec.md) | shipped | — |
| 013 | [Production Maintainability Refactoring Approach](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/013-refactor-approach/spec.md) | shipped | — |
| 014 | [기억 시각화 대시보드 (Embedding Map)](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/014-embedding-map-dashboard/spec.md) | shipped | — |
| 015 | [대시보드 앵커 맵 검색 안정화](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/015-fix-anchor-map-search/spec.md) | shipped | [#150](https://github.com/jee1/memento/issues/150) |
| 016 | [Environment Config Cleanup](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/016-env-config-cleanup/spec.md) | shipped | [#153](https://github.com/jee1/memento/issues/153) |
| 017 | Agent Integration Contracts | shipped | [#453](https://github.com/jee1/memento/issues/453) |
| 018 | Claude Code Adapter | shipped | [#457](https://github.com/jee1/memento/issues/457) |
| 019 | Codex Lifecycle Adapter | shipped | [#459](https://github.com/jee1/memento/issues/459) |
| 020 | Agent Operations CLI | shipped | [#458](https://github.com/jee1/memento/issues/458) |
| 021 | Agent Session Dashboard and Transcript Import | shipped | [#460](https://github.com/jee1/memento/issues/460) |
| 022 | Agent Memory Benchmark | shipped | [#455](https://github.com/jee1/memento/issues/455) |
| 023 | MCP remember 검증 오류 처리 | shipped | [#444](https://github.com/jee1/memento/issues/444) |
| 024 | 주간 관계 검증 타임아웃 | shipped | [#446](https://github.com/jee1/memento/issues/446) |
| 025 | Triple Extraction Per-Memory Job Timeout | shipped | [#475](https://github.com/jee1/memento/issues/475) |
| 026 | VectorSearchRepository.hybridSearch Scope Filters | shipped | [#387](https://github.com/jee1/memento/issues/387) |
| 027 | remember 관계 추출용 기존 기억 조회 수정 | shipped | [#544](https://github.com/jee1/memento/issues/544) |
| 028 | 대시보드 static JS God function 분해 | shipped | [#546](https://github.com/jee1/memento/issues/546) |
| 029 | HTTP 클라이언트 중복 제거 | shipped | [#584](https://github.com/jee1/memento/issues/584) |
| 030 | core debt markers 정리 | shipped | [#586](https://github.com/jee1/memento/issues/586) |
| 031 | performance-monitor.ts 분해 | shipped | [#594](https://github.com/jee1/memento/issues/594) |
| 032 | relation-graph.ts 분해 | shipped | [#595](https://github.com/jee1/memento/issues/595) |
| 033 | semantic-memory-update-service.ts 분해 | shipped | [#598](https://github.com/jee1/memento/issues/598) |
| 034 | sqlite-agent-integration-repository.ts 분해 | shipped | [#610](https://github.com/jee1/memento/issues/610) |
| 035 | search orchestrator 분해 | shipped | [#611](https://github.com/jee1/memento/issues/611) |
| 036 | scheduler orchestrator 분해 | shipped | [#612](https://github.com/jee1/memento/issues/612) |
| 037 | infrastructure refactor | shipped | [#615](https://github.com/jee1/memento/issues/615) |
| 038 | ollama-connection.spec.ts TODO 정리 | shipped | [#638](https://github.com/jee1/memento/issues/638) |
| 039 | database/init.ts 스키마 초기화 모듈화 | shipped | [#631](https://github.com/jee1/memento/issues/631) |
| 040 | graph.js + embedding-map-chart.js 복잡도 분해 | shipped | [#633](https://github.com/jee1/memento/issues/633) |
| 041 | core-deprecated-inventory API 제거 | shipped | [#636](https://github.com/jee1/memento/issues/636) |
| 042 | MCP SDK·better-sqlite3 등 의존성 업데이트 | shipped | [#637](https://github.com/jee1/memento/issues/637) |
| 043 | Triple Extraction Gemini 재시도 WARN 로그 완화 | shipped | [#551](https://github.com/jee1/memento/issues/551) |
| 044 | HTTP Scoped API Tokens | shipped | [#662](https://github.com/jee1/memento/issues/662) |
| 045 | HTTP Audit & Rate Limit | shipped | [#663](https://github.com/jee1/memento/issues/663) |
| 047 | CI Search Quality Gate | shipped | [#665](https://github.com/jee1/memento/issues/665) |
| 048 | Epic #661 Phase 1–3 | shipped | [#661](https://github.com/jee1/memento/issues/661) |
| 049 | Epic #680 Tech-Debt | shipped | [#680](https://github.com/jee1/memento/issues/680) |
| 050 | Durable Event Outbox | shipped | [#659](https://github.com/jee1/memento/issues/659) |
| 051 | Hash-Chained Audit Log | shipped | [#660](https://github.com/jee1/memento/issues/660) |
| 052 | Performance alert WARN 노이즈 완화 | shipped | [#697](https://github.com/jee1/memento/issues/697) |
| 053 | Node 24용 .nvmrc 및 로컬 가이드 | shipped | [#701](https://github.com/jee1/memento/issues/701) |
| 054 | 메인 Dockerfile Node 24 | shipped | [#702](https://github.com/jee1/memento/issues/702) |
| 055 | @types/node@24 및 native 검증 체크리스트 | shipped | [#703](https://github.com/jee1/memento/issues/703) |
| 056 | Anchor Map 이웃 지식 복구 | shipped | [#707](https://github.com/jee1/memento/issues/707) |
| 057 | Production Recall Benchmark & Scorecard | shipped | [#737](https://github.com/jee1/memento/issues/737) |
| 058 | introspection 기반 품질 치유 배치·API | shipped | [#728](https://github.com/jee1/memento/issues/728) |
| 059 | remember write-path near-duplicate 감지·병합 제안 | shipped | [#730](https://github.com/jee1/memento/issues/730) |
| 060 | 2026-08 운영·보안·배포 기술 부채 | shipped | [#748](https://github.com/jee1/memento/issues/748) |
| 061 | Production Recall 격차 진단 및 검색 정확성 복원 | shipped | [#785](https://github.com/jee1/memento/issues/785) |
| 062 | Canonical Memento Resource URIs | shipped | [#656](https://github.com/jee1/memento/issues/656) |
| 063 | remember source agent 식별자 허용 | shipped | [#696](https://github.com/jee1/memento/issues/696) |
| 064 | Recall metadata wait removal & FTS·vector parallelism | shipped | [#735](https://github.com/jee1/memento/issues/735) |
