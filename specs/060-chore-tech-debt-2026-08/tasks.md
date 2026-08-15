# Tasks: Epic #748 — chore tech-debt 2026-08

**Input**: Design documents from `/specs/060-chore-tech-debt-2026-08/`  
**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md), [research.md](./research.md)  
**Branch / worktree**: `060-chore-tech-debt-2026-08` (exists)  
**Parent**: #748 · **PR rule**: 1 child issue = 1 PR · body에 `Fixes #<n>` + `Part of #748`

**Tests**: Constitution I — 이슈마다 **실패 재현/회귀 테스트 선행 → 수정 → 통과**.  
**Organization**: Setup → 이슈별 User Story 위상(plan 순서) → Polish. Foundational 공유 인프라는 없음(독립 PR).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 서로 다른 파일·공유 의존 없음(진짜 병렬만)
- **[USn]**: spec User Story ↔ 자식 이슈 매핑
- 설명에 **exact file paths** 포함

| US | Issue | Title |
|----|-------|-------|
| US1 | #752 | fix(pack): 배포 tarball 런타임 closure |
| US2 | #754 | fix(recall): filters wire · 채널 격리 |
| US3 | #750 | fix(scripts): monorepo import 경로 |
| US4 | #755 | fix(db): memory_embedding rebuild 원자성 |
| US5 | #751 | fix(ci): nightly MigrationRunner 실실행 |
| US6 | #756 | chore(security): fixable audit + gate |
| US7 | #753 | perf(embedding): metadata repair → migration |
| US8 | #749 | test(architecture): 의존 방향 · runtime cycle |

권장 착수: **#752 → #754 → #750 → #755 → #751 → #756 → #753 → #749**. `#755`와 `#753`은 동일 `migrate.ts`/`memory_embedding` → **직렬**.

---

## Phase 1: Setup (Shared)

**Purpose**: 이미 있는 Spec Kit 브랜치/스펙 확인(라이트). 코드 구현 없음.

- [x] T001 Confirm branch/worktree `060-chore-tech-debt-2026-08` and docs present: `specs/060-chore-tech-debt-2026-08/{spec,plan,research,tasks}.md`
- [x] T002 [P] Baseline smoke (read-only): `npm run check-debt-markers -- --production-only` · `npm run type-check` · `npm run lint` (에픽 baseline; 실패 시 기록만, 이 단계에서 수정하지 않음)

**Checkpoint**: Spec Kit 산출물·브랜치 확인됨 → US1(#752)부터 착수 가능

---

## Phase 2: User Story 1 — #752 pack runtime closure (Priority: P1) 🎯 MVP

**Goal**: 빈 temp에 `npm pack` 설치 후 workspace-less bin smoke 성공; `verify-npm-pack-bundle`이 server 런타임 closure 누락 시 실패. `@memento/agent-integration`은 registry publish 없이 prepack/`bundledDependencies`로 bundle.

**Independent Test**: empty-temp install + bin smoke + verify 회귀만으로 검증.

### Tests first (MUST FAIL)

- [x] T003 [US1] Add/extend failing regression so `scripts/verify-npm-pack-bundle.js` asserts server runtime closure paths (not only `@memento/core`) — expect **FAIL** while `express-rate-limit` / `helmet` / `umap-js` / `@memento/agent-integration` omitted from pack
- [x] T004 [P] [US1] Add failing empty-temp pack→install→root bin smoke checklist/script expectation (workspace-less) documenting current FAIL (native rebuild scope: gate vs docs — plan open question)

### Implementation

- [x] T005 [US1] Align root `package.json` `dependencies` with server externals: add `express-rate-limit`, `helmet`, `umap-js` (compare `packages/memento-server/package.json`)
- [x] T006 [US1] Extend `scripts/prepack-bundle-core.js` + root `bundledDependencies` so `@memento/agent-integration` is bundled into tarball (no registry publish; no new bundler)
- [x] T007 [US1] Expand `scripts/verify-npm-pack-bundle.js` to fail on missing server runtime closure (beyond `REQUIRED = .../@memento/core/dist/index.js`)

### Verify / PR

- [x] T008 [US1] Make T003–T004 green: `npm run verify-pack-bundle` · empty-temp `npm pack` → install → bin smoke
- [x] T009 [US1] Gates: `npm run type-check` && `npm run lint` · CHANGELOG if release-note worthy · PR `Fixes #752` / `Part of #748` (scripts/package.json only → graphify 불필요)

**Checkpoint**: #752 MVP 독립 전달 가능

---

## Phase 3: User Story 2 — #754 recall filters · channel isolation (Priority: P1)

**Goal**: nested `filters`가 RecallTool에 적용; `crossChannelRecall=off` 시 타 채널 0건; `channel-isolation.e2e` unskip; assistant `test:ci`에 `test/` 포함. top-level MCP 필드 호환 유지.

**Independent Test**: filters normalize 단위/통합 + e2e unskip + assistant CI path.

### Tests first (MUST FAIL)

- [ ] T010 [US2] Add failing unit/integration: nested `filters` (tags/type 등) not applied when only nested — cover `packages/memento-core/src/tools/index.ts` / recall path (client shape from `packages/memento-client/src/client/search-client.ts`)
- [ ] T011 [P] [US2] Remove `it.skip` in `packages/memento-assistant/test/e2e/channel-isolation.e2e.spec.ts` so suite **fails** until filters honored (`crossChannelRecall=off` → 타 채널 0건)
- [ ] T012 [P] [US2] Failing/compat cases: malformed · missing `filters`; top-level + nested co-existence (API 호환, Constitution II)

### Implementation

- [ ] T013 [US2] Flatten nested `filters` **once** at shared `executeTool` in `packages/memento-core/src/tools/index.ts` (canonical); keep top-level MCP fields valid
- [ ] T014 [US2] Align HTTP entry only if needed in `packages/memento-server/src/server/routes/tools.routes.ts` — **no duplicate flatten**; `packages/memento-core/src/domains/memory/tools/recall-tool.ts`는 검증/회귀 위주
- [ ] T015 [US2] Update `packages/memento-assistant/package.json` `test:ci` to include `test/` (not `src` only)

### Verify / PR

- [ ] T016 [US2] Green: core filters/recall tests · `npm run test:ci -w @memento/assistant` (channel-isolation e2e 통과) · `npm run type-check` && `npm run lint`
- [ ] T017 [US2] graphify rebuild (production code) · CHANGELOG if needed · PR `Fixes #754` / `Part of #748`

**Checkpoint**: #754 독립 전달 가능

---

## Phase 4: User Story 3 — #750 ops scripts import paths (Priority: P1)

**Goal**: 등록된 root npm ops 스크립트의 루트 `src/` import 0건; CLI `--help`/analyze smoke; 파라미터화 CLI/import smoke를 CI에 포함(SQL 재구현 테스트 대체).

**Independent Test**: import 0건 검사 + CLI smoke + `test:ci:scripts`.

### Tests first (MUST FAIL)

- [ ] T018 [US3] Add failing check: registered root `package.json` ops scripts still resolve `../src/` / root `src/` (expect FAIL; include dynamic/indirect refs per spec Edge Cases)
- [ ] T019 [P] [US3] Add failing parameterized CLI/import smoke under `scripts/__tests__/` that **spawns** CLI (not SQL clone like `scripts/__tests__/migrate-embedding-data.integration.spec.ts`)

### Implementation

- [ ] T020 [US3] Fix registered ops under `scripts/*` to `@memento/core` public/workspace exports; delete unused legacy/archive that still point at root `src/`
- [ ] T021 [US3] Wire `package.json` ops entries + ensure smoke is included in `test:ci:scripts` **outside** `**/*.integration.spec.ts` exclude; minimize new `@memento/core` public exports

### Verify / PR

- [ ] T022 [US3] Green: root `src/` import 0 · `npm run migrate:embedding -- --help` (+ analyze smoke) · `npm run test:ci:scripts` · `npm run type-check` && `npm run lint`
- [ ] T023 [US3] CHANGELOG if needed · PR `Fixes #750` / `Part of #748` (scripts-only → graphify 불필요; core export 추가 시 graphify)

**Checkpoint**: #750 독립 전달 가능

---

## Phase 5: User Story 4 — #755 memory_embedding rebuild atomicity (Priority: P1)

**Goal**: create/copy/drop/rename을 단일 `db.transaction(...)`로; 실패 주입 시 롤백·데이터 보존; 성공·멱등.

**Independent Test**: failure-injection + success/idempotent tests adjacent to migrate.

### Tests first (MUST FAIL)

- [ ] T024 [US4] Add failing failure-injection test (abort after copy / before rename) asserting live `memory_embedding` + rows survive — target `packages/memento-core/src/infrastructure/database/database/migrate.ts` (`needsRebuild` path ~L91–175); place under migrate-adjacent `__tests__`

### Implementation

- [ ] T025 [US4] Wrap create/copy/drop/rename only in better-sqlite3 `db.transaction(...)` in `packages/memento-core/src/infrastructure/database/database/migrate.ts` (no new migration framework; confirm vec-trigger drop in/out of atomic unit per research)

### Verify / PR

- [ ] T026 [US4] Green: `npm test -- packages/memento-core/src/infrastructure/database` (atomicity · success · idempotent) · `npm run type-check` && `npm run lint`
- [ ] T027 [US4] graphify rebuild · CHANGELOG if needed · PR `Fixes #755` / `Part of #748`

**Checkpoint**: #755 독립 전달 가능 (#753 전에 완료 권장)

---

## Phase 6: User Story 5 — #751 nightly MigrationRunner (Priority: P1)

**Goal**: nightly가 MigrationRunner 통합 테스트 **9건** 수집·실행; 0 tests → 스텝 실패; PR CI exclude 유지. Prefer `VITEST_INCLUDE_MIGRATION_RUNNER=1` (blanket `CI=` unset보다).

**Independent Test**: flag on → 9 collected; flag off/PR → exclude; 0-tests fail.

### Tests first / repro (MUST FAIL or prove empty collect)

- [ ] T028 [US5] Repro: with `CI=true` as in `.github/workflows/nightly-tests.yml`, show `vitest.config.ts` exclude drops `**/migration-runner.integration.spec.ts` (0 collected for that path) — document FAIL of “nightly truthfulness”

### Implementation

- [ ] T029 [US5] Gate exclude in `vitest.config.ts` on dedicated include flag (e.g. `VITEST_INCLUDE_MIGRATION_RUNNER=1`), not solely `CI`
- [ ] T030 [US5] Update `.github/workflows/nightly-tests.yml`: set include flag on migration-runner step; **fail step if collected tests == 0**; keep PR workflow exclude intent

### Verify / PR

- [ ] T031 [US5] Verify: flag on → 9 tests run; flag off / PR CI → still excluded; sibling files in same nightly step still behave as intended · no type-check/lint impact required beyond workflow/config
- [ ] T032 [US5] PR `Fixes #751` / `Part of #748` (workflow/config only → graphify 불필요)

**Checkpoint**: #751 독립 전달 가능

---

## Phase 7: User Story 6 — #756 fixable production audit (Priority: P1)

**Goal**: production `npm audit --omit=dev` fixable High/Moderate = 0; `security-check.yml`에 audit gate; upstream-blocked 문서화. wanted-only: `@hono/node-server`, `hono`, `fast-uri`, `ip-address`, `protobufjs`. No ML force-override · no eslint/vitest major.

**Independent Test**: audit before/after + workflow step + smoke/gates.

### Tests first / repro (MUST show debt)

- [ ] T033 [US6] Repro baseline: `npm audit --omit=dev` shows fixable High/Moderate > 0; confirm `.github/workflows/security-check.yml` has **no** `npm audit` step (research Confirmed)

### Implementation

- [ ] T034 [US6] Wanted-only bumps in `package-lock.json` / owning workspace `package.json` for listed packages; re-measure live audit at implement time
- [ ] T035 [P] [US6] Add failing gate step `npm audit --omit=dev` to `.github/workflows/security-check.yml`
- [ ] T036 [P] [US6] Document upstream-blocked (onnxruntime/sharp 등) in existing ops/security docs path (no force-override)

### Verify / PR

- [ ] T037 [US6] Green: fixable High/Moderate = 0 · smoke · `npm run type-check` && `npm run lint` · PR `Fixes #756` / `Part of #748` (lockfile/docs/workflow → graphify 불필요)

**Checkpoint**: #756 독립 전달 가능

---

## Phase 8: User Story 7 — #753 embedding metadata repair off hot path (Priority: P2)

**Goal**: `ensureMetadataDefaults`를 bootstrap/`migrate.ts`에서 1회; create/search/stats hot path 테이블 전역 UPDATE 0; 신규 행 기본값; legacy fixture + query-count.

**Independent Test**: query-count + legacy fixture. **After #755**.

### Tests first (MUST FAIL)

- [ ] T038 [US7] Add failing query-count / legacy-fixture tests: create · `searchBySimilarity` · `getEmbeddingStats` in `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts` still call table-wide repair (`ensureMetadataDefaults` ~L595–635) → expect count > 0 **FAIL criteria for green**

### Implementation

- [ ] T039 [US7] Move `ensureMetadataDefaults` SQL to bootstrap / `packages/memento-core/src/infrastructure/database/database/migrate.ts` (or existing init path) once
- [ ] T040 [US7] Remove hot-path calls at ~L401, ~L449, ~L534 in `memory-embedding-service.ts`; ensure new rows get metadata defaults (`created_by = 'legacy'` semantics preserved)

### Verify / PR

- [ ] T041 [US7] Green: `npm test -- packages/memento-core/src/domains/memory` (metadata / query-count) · `npm run type-check` && `npm run lint`
- [ ] T042 [US7] graphify rebuild · CHANGELOG if needed · PR `Fixes #753` / `Part of #748`

**Checkpoint**: #753 독립 전달 가능

---

## Phase 9: User Story 8 — #749 architecture boundaries · cycles (Priority: P2)

**Goal**: `dependency-boundaries.spec.ts`가 금지 방향 신규 위반을 CI 실패; allowlist+rationale; runtime cycle 2건 제거; allowlist 무분별 증가 차단. No madge/dependency-cruiser. Status: research **Partial** — implement 시 cycle·allowlist refresh.

**Independent Test**: architecture spec only.

### Tests first (MUST FAIL on residual debt)

- [ ] T043 [US8] Extend `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts` so new domain→infra / shared→infra|server imports **fail**; freeze current offenders in allowlist+rationale; assert remaining cycles **fail** until broken (refresh AST/`rg` snapshot at implement)
- [ ] T044 [P] [US8] Confirm cycle edges still present before fix: `shared/utils/database.ts` ↔ schema-init/fts5; `batch-scheduler` ↔ `batch-scheduler-singleton` (docs claim `docs/agents/architecture.md` ~L21)

### Implementation

- [ ] T045 [US8] Break cycle 1: `packages/memento-core/src/shared/utils/database.ts` ↔ schema-init/fts5 (`import type` / helpers 분리)
- [ ] T046 [US8] Break cycle 2: `batch-scheduler` ↔ `batch-scheduler-singleton` (`batch-scheduler-types` / AGENTS.md 패턴)
- [ ] T047 [P] [US8] Allowlist growth guard (CI fail or explicit review requirement); align `docs/agents/architecture.md` if needed

### Verify / PR

- [ ] T048 [US8] Green: `npm test -- packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts` · `npm run type-check` && `npm run lint`
- [ ] T049 [US8] graphify rebuild · CHANGELOG if needed · PR `Fixes #749` / `Part of #748`

**Checkpoint**: #749 독립 전달 가능

---

## Phase 10: Polish & Cross-Cutting (Epic close)

**Purpose**: 에픽 마무리. 자식 PR 머지 후 또는 마지막 PR과 함께.

- [x] T050 Confirm each merged PR had `Fixes #<n>` + `Part of #748`; epic checklist in #748 updated
- [x] T051 [P] Epic-level CHANGELOG Unreleased rollup if child PRs omitted notes
- [x] T052 [P] Final baseline: `npm run check-debt-markers -- --production-only` · `npm run type-check` · `npm run lint`
- [x] T053 After last production-code PR: graphify rebuild `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` and commit root `graphify-out/` only
- [x] T054 Mark `specs/060-chore-tech-debt-2026-08/spec.md` Status → Implemented when all child issues closed; close/complete epic #748

---

## Dependencies & Execution Order

### Phase dependencies

```text
Phase 1 Setup
  → Phase 2 US1 #752 (MVP)
  → Phase 3 US2 #754
  → Phase 4 US3 #750
  → Phase 5 US4 #755
  → Phase 6 US5 #751
  → Phase 7 US6 #756
  → Phase 8 US7 #753  (after #755)
  → Phase 9 US8 #749
  → Phase 10 Polish
```

- **Setup**: 블로킹 최소(확인만).
- **User stories**: 파일 충돌 없으면 비인접 이슈 병렬 가능. **금지/주의**: `#755` ‖ `#753` (동일 migrate/embedding); `#752`와 `#750`은 export/pack 표면 조율.
- **Within each story**: Red(T* tests) → Implement → Verify/PR. 테스트가 녹색이 되기 전 다음 이슈로 넘어가지 말 것.

### Parallel opportunities (true [P] only)

| Story | Parallel-safe |
|-------|----------------|
| Setup | T001 → then T002 |
| US1 | T003 ‖ T004 (다른 산출물) |
| US2 | T010 후 T011 ‖ T012; implement T013→T015 순차 |
| US3 | T018 ‖ T019 |
| US4 | 단일 파일 migrate — 내부 [P] 없음 |
| US5 | T029→T030 순차 |
| US6 | T035 ‖ T036 after T034 |
| US7 | T039→T040 순차 (#755 완료 후) |
| US8 | T043 ‖ T044; T045→T046 순차; T047 [P] |
| Polish | T051 ‖ T052 |

### User story → FR / SC

| US | FR | SC |
|----|----|----|
| US1 #752 | FR-001, FR-002 | SC-001, SC-002 |
| US2 #754 | FR-003–FR-006 | SC-003 |
| US3 #750 | FR-007, FR-008 | SC-004 |
| US4 #755 | FR-009, FR-010 | SC-005 |
| US5 #751 | FR-011, FR-012 | SC-006 |
| US6 #756 | FR-013, FR-014 | SC-007 |
| US7 #753 | FR-015, FR-016 | SC-008 |
| US8 #749 | FR-017, FR-018 | SC-009 |
| All | FR-019, FR-020 | SC-010 |

---

## Parallel Example: US1 (#752)

```bash
# Red in parallel (different artifacts):
Task: "T003 verify-npm-pack-bundle server closure FAIL"
Task: "T004 empty-temp pack/install/bin smoke FAIL"

# Then serial implement:
Task: "T005 root deps" → "T006 prepack bundle" → "T007 verify expand" → "T008 green" → "T009 gates/PR"
```

---

## Implementation Strategy

### MVP First (User Story 1 / #752 only)

1. Phase 1 Setup (T001–T002)
2. Phase 2 US1 #752 (T003–T009)
3. **STOP and VALIDATE**: empty-temp pack smoke + `verify-pack-bundle`
4. Open PR `Fixes #752` / `Part of #748`

### Incremental Delivery

각 이후 위상 = 독립 PR. P0 전부 후 P1(#753, #749). Polish로 에픽 닫기.

### Notes

- [P] = 다른 파일·의존 없음만. 같은 `migrate.ts` / `memory-embedding-service.ts` 동시 작업 금지.
- SQL 재구현으로 #750을 “통과”시키지 말 것.
- #756: wanted-only; onnxruntime/sharp force-override 금지.
- #749: 신규 analyzer 의존성 금지; allowlist 무분별 증가 금지.
- production 코드 PR마다 graphify; scripts/workflow/lockfile-only는 생략 가능.
