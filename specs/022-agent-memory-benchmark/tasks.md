# Tasks: Agent Memory Benchmark

## Specification

- [x] T001 #455, epic #452, constitution 요구를 정리한다.
- [x] T002 retrieval-only, E2E, graph experiment scenario를 분리한다.
- [x] T003 동일 조건 baseline과 adoption gate를 정의한다.

## Research and Design

- [x] T004 benchmark-v3 helper/scripts와 specs/017 계약을 조사한다.
- [x] T005 LongMemEval-S adapter contract와 corpus governance를 결정한다.
- [x] T006 deterministic vector/RRF/latency 재현 경계를 결정한다.
- [x] T007 report, entity, gate data model을 작성한다.

## Test-First

- [x] T008 adapter normalize/invalid/secret failing tests를 작성한다.
- [x] T009 metric, RRF, token, duplicate/session bias failing tests를 작성한다.
- [x] T010 graph adoption gate failing tests를 작성한다.
- [x] T011 full fixture runner integration failing test를 작성한다.

## Implementation

- [x] T012 native fixture loader와 LongMemEval-S adapter를 구현한다.
- [x] T013 corpus/query/edge/E2E validator와 secret scanner를 구현한다.
- [x] T014 grep, FTS-only, vector, Memento baseline을 구현한다.
- [x] T015 graph candidate stream과 RRF feature flag를 구현한다.
- [x] T016 retrieval/E2E metric과 gate를 구현한다.
- [x] T017 reproduction manifest와 JSON report writer를 구현한다.
- [x] T018 package scripts와 synthetic licensed fixture/docs를 추가한다.

## Verification

- [x] T019 targeted tests를 실행한다.
- [x] T020 benchmark-v3 regression scripts/tests를 실행한다.
- [x] T021 lint와 type-check를 실행한다.
- [x] T022 security/static checks를 실행한다.
- [x] T023 graphify를 rebuild한다.
- [x] T024 diff/PR self-review를 수행한다.
- [ ] T025 Lore commit, push, Draft PR을 생성한다.

## Validation Notes

- `npm run quality:agent-memory:test`: 2 files, 11 tests passed.
- native fixture와 LongMemEval-S sample CLI smoke: passed.
- graph-RRF fixture: R@10 `0.8333 -> 1.0000`, MRR/NDCG 비열화 없음, adoption gate passed.
- benchmark-v3: category verification passed; 4 files, 18 regression tests passed.
- `npm run lint`: 0 errors, 기존 security warning 245건.
- `npm run type-check`: 6 workspaces passed. Worktree-local `npm install --ignore-scripts --offline` 후 workspace link를 복구해 검증했다.
- security workflow: SQL/PII/path static checks, 68 security unit tests, SQL injection 5 cases, path traversal 7 cases passed.
- `npm audit --audit-level=high`: 기존 lockfile에서 32건(critical 3, high 16, moderate 13)을 보고했다. dependency/lockfile 변경은 없다.
- graphify rebuild: 5,444 nodes, 6,691 edges, 1,089 communities.
