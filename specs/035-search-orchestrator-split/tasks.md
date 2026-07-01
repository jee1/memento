# Tasks: 035-search-orchestrator-split

## Phase 1 — Baseline

- [x] T001 worktree `memento-issue-611` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 search domain vitest baseline 확인

## Phase 2 — Extract vector-search modules

- [x] T004 `vector-search.types.ts` 추출
- [x] T005 `vector-search-availability.ts` 추출
- [x] T006 `vector-search-runtime-context.ts` 추출
- [x] T007 `vector-search-scope.ts` 추출
- [x] T008 `vector-search-result-mapper.ts` 추출
- [x] T009 `vector-search-knn-query.ts` 추출
- [x] T010 `vector-search-hybrid-query.ts` 추출
- [x] T011 `vector-search.repository.ts` 오케스트레이션으로 축소

## Phase 3 — Extract search-engine modules

- [x] T012 `search-engine.types.ts` 추출
- [x] T013 `search-engine-fts-query.ts` 추출
- [x] T014 `search-engine-fts-availability.ts` 추출
- [x] T015 `search-engine-ranking.ts` 추출
- [x] T016 `search-engine-sql-builder.ts` 추출
- [x] T017 `search-engine.ts` 오케스트레이션으로 축소

## Phase 4 — Verify

- [x] T018 vector-search + search-engine vitest green
- [x] T019 build + lint + type-check green
- [x] T020 graphify rebuild
- [ ] T021 PR 등록 (Closes #611)
