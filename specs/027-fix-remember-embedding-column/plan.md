# Implementation Plan: remember 관계 추출용 기존 기억 조회 수정

**Branch**: `issue-544-remember-embedding-fix` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)  
**Input**: GitHub Issue #544

## Summary

`remember-tool.ts`의 `getExistingMemoriesForRelationExtraction`·`getMemoryById`가 운영 스키마에 없는 `memory_item.embedding` 컬럼을 SELECT하여 `no such column: embedding` 오류가 발생하고, catch 블록에서 `기존 기억 조회 실패` warn 후 빈 배열이 반환되어 관계 추출이 스킵된다. 임베딩은 `memory_embedding` 테이블에 저장되므로 두 private 메서드의 SELECT·row mapping에서 `embedding` 참조를 제거한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥ 24, ES modules  
**Primary Dependencies**: `better-sqlite3`, `@memento/core`, Vitest  
**Storage**: SQLite — 스키마/마이그레이션 변경 없음  
**Testing**: Vitest co-located spec `remember-tool-relation-load.spec.ts`  
**Target Platform**: memento-core `RememberTool`  
**Constraints**: 관계 추출 경로만 수정; `memory_embedding` JOIN 품질 개선은 범위 외

## Project Structure

```text
specs/027-fix-remember-embedding-column/
├── spec.md
├── plan.md
└── tasks.md

packages/memento-core/src/domains/memory/tools/
├── remember-tool.ts                              # [수정] embedding SELECT/매핑 제거
└── __tests__/
    └── remember-tool-relation-load.spec.ts       # [신규] 회귀 테스트
```

## Implementation Notes

| Method | Change |
|--------|--------|
| `getExistingMemoriesForRelationExtraction` | SELECT에서 `embedding` 제거; row mapping에서 `embedding` 파싱 제거 |
| `getMemoryById` | 동일 |
| `MemoryItemRow` | `embedding?` 필드 제거 (해당 메서드 전용) |

회귀 테스트는 `embedding` 컬럼 없이 `is_consolidated` 포함한 최소 `memory_item` 스키마를 사용한다.

## Constitution Check

| Gate | Status |
|------|--------|
| Test-First | 회귀 spec으로 embedding 없는 스키마 검증 |
| Backward Compatibility | 존재하지 않는 컬럼 참조 제거 — 운영 DB와 정합 |
| Schema Discipline | DB/마이그레이션 변경 없음 |
| Quality Gates | lint, type-check, test |
