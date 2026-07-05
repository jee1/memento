# Feature Specification: Epic #661 Phase 1–3 (Issues #666–#673)

**Feature Branch**: `048-661-epic-666-673`
**Created**: 2026-07-05
**Status**: Implemented
**Parent Epic**: #661

---

## Scope

| Issue | Title | Phase |
|-------|-------|-------|
| #666 | feedback 루프 UX 및 랭킹 반영 투명성 | 1 |
| #667 | RelationGraph 1급 API 및 relation ranking 설정 | 1 |
| #668 | JSONL memory export/import 및 스키마 버전 | 2 |
| #669 | TTL/망각 설명 가능 이벤트 로그 | 2 |
| #670 | 시크릿 로딩 가이드 및 DB 암호화 옵션 | 2 |
| #671 | source/출처 필드 표준화 및 recall 노출 | 3 |
| #672 | semantic/procedural Markdown export | 3 |
| #673 | 멀티 에이전트 single-writer 오케스트레이션 템플릿 | 3 |

## Acceptance Criteria (Summary)

### #666
- [x] `MementoClient.recordRecallFeedback()` one-liner helper
- [x] Client integration test
- [x] `get_telemetry_summary` + `/admin/telemetry/feedback` with helpful_rate
- [x] `specs/004-recall-quality-feedback-loop` SC 갱신

### #667
- [x] `add_relation` / `get_relations` / `remove_relation` MCP registry
- [x] Registry integration test
- [x] `MEMENTO_RANKING_WEIGHTS_PATH` / zeta reload 문서
- [x] #657 cross-link

### #668
- [x] `npm run memory:export` / `memory:import`
- [x] JSONL manifest schema_version + checksum
- [x] Round-trip test
- [x] DR workflow doc

### #669
- [x] `memory_forgetting_event` audit table + migration
- [x] Batch cleanup event log test
- [x] `GET /admin/forgetting/events` + `npm run forgetting:events`

### #670
- [x] `docs/reference/ko/security.md` secrets + encryption notes
- [x] `docker-compose.prod.secrets.example.yml`

### #671
- [x] `validateSource()` + remember validation
- [x] Recall source round-trip test
- [x] `docs/reference/ko/source-field.md`

### #672
- [x] `export` MCP tool (markdown | jsonl)
- [x] `GET /admin/export?format=markdown`
- [x] Procedural steps frontmatter

### #673
- [x] `apps/multi-agent-orchestration/` README + compose + script
- [x] Parallel writers anti-pattern documented
