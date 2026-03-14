# Procedural Memory 고급 버전 관리 — SPEC 요약

SDD **Specify** 단계 사후 요약. Issue #57 Phase 2 1단계(A).

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | Procedural Memory 버전 관리 (version, diff, rollback) |
| **문서 유형** | SPECIFY (요약 명세) |
| **날짜** | 2026-02-05 |
| **설계** | [design.md](./design.md) |
| **구현 계획** | [implementation-plan.md](./implementation-plan.md) |

---

## 범위·요구사항 요약

- **범위**: memory_item에 version·version_series_id 추가, procedural_diff·procedural_rollback, recall에 version_filter·include_version_chain·include_diff_with.
- **요구사항**: 스키마 확장, procedural-versioning·procedural-memory-diff·procedural-rollback-service, MCP 툴 노출, remember/reflexion-worker에서 버전 필드 설정.
- **수용 기준**: 타입·스키마·서비스·MCP 툴·recall 옵션 동작, 테스트 통과.

**다음 단계**: [implementation-plan.md](./implementation-plan.md)
