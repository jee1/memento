# Tasks: remember 관계 추출용 기존 기억 조회 수정

**Input**: `specs/027-fix-remember-embedding-column/` (spec.md, plan.md)  
**Issue**: #544

## Phase 1: Regression tests (TDD)

- [ ] T001 [US1] `remember-tool-relation-load.spec.ts` — embedding 없는 최소 `memory_item` 스키마 + `is_consolidated` fixture
- [ ] T002 [US1] `getExistingMemoriesForRelationExtraction` — exclude ID 외 기존 기억 반환 검증
- [ ] T003 [US1] `기존 기억 조회 실패` logWarning 미발생 검증
- [ ] T004 [US1] `getMemoryById` — id로 content/type 등 필드 반환 검증

## Phase 2: Core fix

- [ ] T005 [US1] `remember-tool.ts` — 두 private SELECT에서 `embedding` 제거
- [ ] T006 [US1] row mapping에서 `embedding` JSON 파싱 제거
- [ ] T007 [US1] `MemoryItemRow`에서 `embedding` 필드 정리

## Phase 3: Verification & ship

- [ ] T008 [POLISH] targeted vitest → `npm run lint`, `npm run type-check`, `npm test`
- [ ] T009 [POLISH] graphify 코드 그래프 재빌드
- [ ] T010 [POLISH] 커밋, push, PR 생성 (Closes #544)

## Dependencies

T001–T004 → T005–T007 → T008 → T009 → T010
