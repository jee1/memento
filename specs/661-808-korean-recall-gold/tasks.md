# Tasks: 한국어 recall gold set 구축 및 #785 recall 재측정

> **For agentic workers:** 태스크 단위 실행. `[TDD]` = RED→GREEN→REFACTOR. 페이즈 체크포인트에서 승인 후 진행 (`/speckit.superspec.execute`).

**Goal**: 합성 한국어 gold + 기존 agent-memory 하네스 arm으로 R@10/MRR을 기록하고, LoCoMo `memento_prod` 수정 후 baseline·#804/#807 전후를 SHA/ranking hash와 함께 재현 가능하게 남긴다 (#808).

**Architecture**: `tests/fixtures/agent-memory-benchmark-ko` + `korean-gold-validate` + `agent-memory-benchmark --fixture --production`. LoCoMo 1536은 기존 `--locomo --production` 로컬 절차. 수치 gate·신규 nightly·새 프레임워크 없음.

**Tech Stack**: TypeScript 5.x, Node ≥24, Vitest, 기존 benchmark scripts. 신규 npm dep 없음.

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) | **Data model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/korean-gold-fixture.md](./contracts/korean-gold-fixture.md), [contracts/scorecard-korean-arm.md](./contracts/scorecard-korean-arm.md) | **Quickstart**: [quickstart.md](./quickstart.md)

**Input**: Design documents from `/specs/661-808-korean-recall-gold/`  
**Tests**: 필수 (헌법 I). 스키마 검증·fail-closed·픽스처 적재 없이 완료 금지.

## Format: `[ID] [markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 파일 비겹침 시 병렬 |
| `[TDD]` | RED → GREEN |
| `[REVIEW]` | 사람 리뷰 후 진행 |
| `[SUBAGENT]` | 서브에이전트 위임 가능 |

## Global Constraints

- Node ≥24, TS ESM, npm workspaces.
- Measure-only: R@10/MRR **수치 gate 금지**; #731 REQUIRED_MACRO 편입 금지 (FR-024).
- LoCoMo/라이브 원문·파생 **커밋 금지** (FR-009); 공개 문서는 집계·ID·해시만.
- 커밋 gold: synthetic ≥15; tags `particle_agglutination`|`short_multi_concept`|(opt)`triple_isolation_probe`; opaque queryId; non-empty relevantIds; `ko_mem_*` only (FR-012–015,021,026,028).
- CI: validate/smoke only — **no 1536** (FR-017).
- MCP schema / `ranking-weights.toml` 미변경.
- Complete: `npm run lint`, `npm run type-check`, targeted vitest. graphify only if production core touched (else N/A).
- Branch: `feature/test-quality-recall-gold-set-785-recall`. No push/PR without ask.
- Commits: `Refs #808`.

---

## Phase 1: Setup

**Purpose**: 기준선·산출물 스텁.

- [x] **T001** 기준선 + 스텁 파일

  Run:

  ```bash
  npx vitest run scripts/agent-memory-benchmark.spec.ts scripts/agent-memory-benchmark-adapter.spec.ts
  ```

  Create empty stubs (fill later):
  - `specs/661-808-korean-recall-gold/remasure-locomo.md`
  - `specs/661-808-korean-recall-gold/before-after-804-807.md`
  - `specs/661-808-korean-recall-gold/redaction-checklist.md` (FR-025 bullets)

  Expected: existing adapter specs PASS. Fail → stop.

**Checkpoint**: green baseline → Phase 2.

---

## Phase 2: Foundational (Blocking)

**Purpose**: 스키마 계약 + validator. **US1–US4 전부 의존.**

⚠️ T004 완료 전 Korean fixture 대량 authoring / remasure 완료 선언 금지.

- [x] **T002** [TDD] [P] `korean-gold-validate` Red tests

  **Files:** `scripts/korean-gold-validate.spec.ts` (new)

  Cases: &lt;15 queries fail; missing `particle_agglutination` fail; empty relevantIds fail; duplicate/opaque-id=query-text fail; unknown tag fail; live-looking id fail.

  Run: `npx vitest run scripts/korean-gold-validate.spec.ts` → expect RED.

- [x] **T003** [TDD] Implement `scripts/korean-gold-validate.ts` to green T002

  CLI: `--fixture <dir>`; exit 0/1. Align [contracts/korean-gold-fixture.md](./contracts/korean-gold-fixture.md).

- [x] **T004** [P] Wire CI/docs hook for validator

  **Files:** `package.json` script e.g. `quality:korean-gold:validate`; mention in `docs/guides/ko/benchmark-datasets.md` (short section). Optional `quality.ts` COMMAND alias.

**Checkpoint**: validator green on intentional bad fixtures (temp) + ready for real gold → Phase 3.

---

## Phase 3: User Story 2 — 한국어 gold (P1) 🎯

**Goal**: ≥15 synthetic Q–A with required tags; self-contained corpus.

**Independent Test**: `korean-gold-validate --fixture …-ko` exits 0; particle + multi-concept present.

- [x] **T005** [US2] [SUBAGENT] Create `tests/fixtures/agent-memory-benchmark-ko/` corpus+queries

  **Files:** `manifest.json`, `corpus.jsonl`, `queries.json`, `graph-edges.json`, `e2e-cases.json`, `README.md`

  Include ≥1 particle case (body has agglutinated form; query stem) and ≥1 short multi-concept. IDs `ko_mem_*` / opaque `kq_*`.

- [x] **T006** [TDD] [US2] Validator accepts real fixture; assertDatasetSafe compatible

  Run validate + `loadAgentMemoryFixture` path test (extend adapter spec or new).

**Checkpoint**: US2 done — committed gold validates.

---

## Phase 4: User Story 3 — 하네스 arm (P1)

**Goal**: Documented `--fixture` production run emits R@10+MRR; arm/measure-only labeling; EN keys untouched.

**Independent Test**: production run on ko fixture writes scorecard with `recall_at_10`+`mrr`; report has `reproduction.git_sha`+`ranking_version`.

- [x] **T007** [TDD] [US3] Arm / measure-only labeling

  **Files:** `scripts/agent-memory-benchmark.ts` (+ spec)

  Add `--arm korean` (or equivalent) and `measure_only: true` on report/scorecard metadata. Missing arm when required → explicit error (FR-019). Do not break default English fixture path.

- [x] **T008** [P] [US3] Optional tags → category split in scorecard if cheap

  Extend adapter to surface tags for by_category / FR-008; else document “validate-only tags” and skip — prefer implement if &lt;1h.

- [x] **T009** [US3] Docs: quickstart already; update `docs/guides/ko/benchmark-datasets.md` Korean arm section

**Checkpoint**: Korean arm runnable; CI validate still green.

---

## Phase 5: User Story 1 — LoCoMo remasure (P1)

**Goal**: Post-#785 `memento_prod` R@10/MRR in artifact + aggregates in `remasure-locomo.md`.

**Independent Test**: With `.local/locomo/` present, full report exists; markdown has aggregates+SHA+ranking hash+provider. Without corpus: document blocked — do not fake numbers.

- [x] **T010** [US1] Run remasure when corpus available; fill `remasure-locomo.md`

  Commands per [quickstart.md](./quickstart.md). Provider comparable to #785 or mark non-comparable (FR-029).

  **Done as blocked**: `.local/locomo/` absent — `remasure-locomo.md` status=`blocked`, empty metric placeholders, SC-001 explicitly not satisfied. **US1 is blocked, not feature complete.**

- [x] **T011** [P] [US1] Fail-closed notes for missing/incomplete LoCoMo in remasure doc + code comments if any CLI guards added

  FR-018 fail-closed documented in `remasure-locomo.md`. No existing incomplete-promotion CLI guard in scripts → docs only (no invented CLI).

**Checkpoint**: SC-001 satisfied or explicitly blocked on missing acquire (not “done”). → **blocked** (corpus not acquired).

---

## Phase 6: User Story 4 — #804/#807 before-after (P2)

**Goal**: Paired metrics template filled when both sides exist.

- [x] **T012** [US4] Tag optional `triple_isolation_probe` queries (≥1 if reusing #804 set)

  Present: `kq_003` in `tests/fixtures/agent-memory-benchmark-ko/queries.json` (`tags: ["triple_isolation_probe"]`).

- [x] **T013** [US4] Fill `before-after-804-807.md` with available pairs; if only one side, status=`incomplete` (FR-020)

  status=`incomplete` — pairs not both present; fill procedure + Korean gold path documented. **US4 incomplete until paired scorecards exist.**

**Checkpoint**: SC-004 complete only with pairs; else incomplete recorded. → **incomplete**.

---

## Phase 7: Polish

- [x] **T014** [P] Complete `redaction-checklist.md` (FR-025)

- [x] **T015** lint + type-check + targeted vitest (`korean-gold-validate`, adapter, benchmark specs)

  ```bash
  npm run lint && npm run type-check
  npx vitest run scripts/korean-gold-validate.spec.ts scripts/agent-memory-benchmark-adapter.spec.ts scripts/agent-memory-benchmark.spec.ts
  ```

  Verified 2026-08-31: lint 0, type-check 0, vitest 43/43, `korean-gold-validate` exit 0. Also `.local/korean-gold/` added to `.gitignore`.

- [x] **T016** [REVIEW] Spec checklist still PASS; progress.yml → tasks_done; no `.local/` or LoCoMo in git status

  Ready for `/speckit.superspec.review`. US1 blocked (LoCoMo absent); US4 incomplete (paired scorecards missing). Feature not “complete” until those clear.

**Checkpoint**: Ready for `/speckit.superspec.review` (or PR when user asks).

---

## Dependencies

```text
T001 → T002 → T003 → T004
T003 → T005 → T006
T006 → T007 → T008 → T009
T006 → T010 → T011
T006 → T012 → T013
T009,T011,T013 → T014 → T015 → T016
```

**Parallel**: T002∥(later T008/T011/T014 after their deps); T005 can [SUBAGENT].

## Implementation Strategy

1. MVP = T001–T009 (gold + arm + docs) — CI-valuable without LoCoMo.
2. US1 remasure when `.local/locomo/` present (blocks “feature complete”).
3. US4 as soon as second condition exists.
4. No ranking/weight changes. No #731 gate.

## Notes

- `setup-plan.sh` branch-name check bypassed; feature dir from `.specify/feature.json`.
- writing-plans skill adapted → this `tasks.md` (not `docs/superpowers/plans/`).
