# Superspec Review: 661-808-korean-recall-gold

**Branch**: `feature/test-quality-recall-gold-set-785-recall`  
**Scope**: Uncommitted working-tree diff vs HEAD + untracked new files  
**Reviewed**: 2026-08-31 (Round 1), 2026-08-31 (Round 2)  
**Reviewer**: code-review-specialist (superspec + requesting-code-review)

## Summary

MVP deliverables (US2 한국어 gold, US3 하네스 arm, validator, docs) are **implementation-complete and test-green**. 합성 픽스처 18질의·닫힌 태그·`ko_mem_*` ID·fail-closed validator·`--arm korean` + `measure_only` 라벨링이 spec/contracts와 정합한다. Constitution(LoCoMo CC BY-NC, synthetic-only commit) 준수. **US1**은 `.local/locomo` 부재로 `remasure-locomo.md` `status=blocked` — FR-016/SC-001 미충족이나 **문서화된 허용 상태**. **US4**는 `before-after-804-807.md` `status=incomplete` — FR-020 허용. CI는 `test:ci:scripts`로 validator·arm smoke를 커버(FR-010/SC-005).

**Round 2**: Prior Important #1 (`--arm korean` in US4 doc) and #2 (FR-013 validate on benchmark load) are **resolved**. Suggestion #3 (redaction sign-off) filled. No new Critical/Important findings at ≥80% confidence.

## Verdict

| Question | Result |
|----------|--------|
| **Ready for PR** (MVP scope: US2+US3+validate+docs) | **PASS** |
| Feature-complete (#808 전체 SC) | **FAIL** (expected: SC-001 blocked, SC-004 incomplete) |

**Merge opinion (Round 2)**: **승인** — MVP PR merge-ready. Round 1 Important items closed; no blocking findings remain.

---

## Round 2 — Fix Verification

| Prior finding | Status | Evidence |
|---------------|--------|----------|
| Important #1 — `before-after-804-807.md` omits `--arm korean` | **RESOLVED** | Example command at `before-after-804-807.md:29-34` includes `--arm korean` |
| Important #2 — FR-013 validate not on benchmark load | **RESOLVED** | `loadDataset` calls `validateKoreanGoldFixture` when `isKoreanGoldFixturePath`, throws on `!ok` (`agent-memory-benchmark.ts:444-451`); spec test `runs korean-gold-validate before scoring Korean fixture (FR-013)` |
| Suggestion #3 — redaction sign-off empty | **RESOLVED** | `redaction-checklist.md:94-96` agent attestation 2026-08-31 |

**Regression check (2026-08-31)**: `npx vitest run scripts/korean-gold-validate.spec.ts scripts/agent-memory-benchmark-adapter.spec.ts scripts/agent-memory-benchmark.spec.ts` → **44/44 pass**; `korean-gold-validate` CLI exit 0.

---

## Spec Compliance Matrix

| ID | Status | Notes |
|----|--------|-------|
| FR-001 / SC-001 | **Blocked (OK)** | `remasure-locomo.md` status=`blocked`; no fake metrics |
| FR-002 | **PASS** | Production scorecard: `ranking_version`, `embedding_provider`, `dataset_sha256`; `git_sha` on `report.reproduction` |
| FR-003, FR-012, SC-007 | **PASS** | 18 queries; ≥1 `particle_agglutination`, ≥1 `short_multi_concept`; validator exit 0 |
| FR-004, FR-015, FR-028 | **PASS** | `manifest.synthetic=true`; `ko_mem_*` only; non-empty `relevantIds` |
| FR-005, FR-019, FR-027 | **PASS** | `--arm korean` required for ko fixture; explicit error; harness extension only |
| FR-006, FR-022, SC-008 | **PASS** | Scorecard `recall_at_10` + `mrr`; `measure_only: true` |
| FR-007, FR-008, SC-004 | **Incomplete (OK)** | `before-after-804-807.md` status=`incomplete`; template + procedure present |
| FR-009, SC-006 | **PASS** | `.local/locomo/`, `.local/korean-gold/` gitignored; fixture synthetic-only |
| FR-010, SC-005 | **PASS** | `korean-gold-validate.spec.ts` + adapter/benchmark ko tests in `test:ci:scripts` |
| FR-011 | **PASS** | Default English fixture path unchanged; 44/44 targeted vitest green |
| FR-013 | **PASS** | Validator fail-closed; `loadDataset` enforces validate before `loadAgentMemoryFixture` (Round 2 fix) |
| FR-014 | **PASS** | `assertDatasetSafe` rejects missing doc IDs at load; LoCoMo skip path pre-existing |
| FR-016, FR-018 | **PASS** | Blocked/incomplete docs; no invented numbers |
| FR-017, FR-023, FR-024 | **PASS** | No CI 1536; measure-only; no #731 gate |
| FR-020 | **PASS** | US4 explicitly incomplete until paired scorecards |
| FR-021, FR-026 | **PASS** | Closed tags; opaque `kq_*` ≠ query text; duplicate-id fail |
| FR-025 | **PASS** | Actionable `redaction-checklist.md` + sign-off |
| FR-029 | **PASS** | FR-029 comparability note in `remasure-locomo.md` |

---

## Constitution Compliance

| Constraint | Status |
|------------|--------|
| LoCoMo CC BY-NC — no commit | **PASS** — `.local/locomo/` gitignored; no LoCoMo bodies in diff |
| Committed fixtures synthetic | **PASS** — `tests/fixtures/agent-memory-benchmark-ko/` |
| Public docs aggregates only | **PASS** — remeasure/before-after tables empty placeholders |
| Principle I (tests) | **PASS** — validator + arm specs; lint/type-check 0 |

---

## Findings (confidence ≥ 80)

### Round 2 — Critical / Important

_None._

### Round 1 — Resolved Important

#### 1. US4 procedure doc omits required `--arm korean` — **RESOLVED**

- **Was**: `before-after-804-807.md` example lacked `--arm korean` (FR-019).
- **Fix**: `--arm korean` added to command block (`before-after-804-807.md:31`).

#### 2. FR-013 validate not enforced on benchmark load path — **RESOLVED**

- **Was**: `loadDataset` used `assertDatasetSafe` only; malformed ko fixture could score if validate skipped.
- **Fix**: `validateKoreanGoldFixture` + throw before load (`agent-memory-benchmark.ts:444-451`); integration spec added.

### Suggestion (non-blocking)

#### 3. FR-013 integration test is positive-only

- **Description**: `runs korean-gold-validate before scoring Korean fixture` asserts valid fixture loads; does not assert malformed fixture throws via `loadDataset`. Fail-closed behavior is covered by `korean-gold-validate.spec.ts` (10 tests).
- **Location**: `scripts/agent-memory-benchmark.spec.ts:340-343`
- **Recommendation**: Optional negative test (temp dir + bad tags) for load-path wiring; not required for MVP.
- **Confidence**: 82

#### 4. Human PR re-confirmation of redaction checklist

- **Description**: Sign-off is agent attestation; checklist asks human PR author to re-confirm §§1–5 before merge.
- **Location**: `redaction-checklist.md:96`
- **Recommendation**: PR description or author checklist tick before merge.
- **Confidence**: 90

---

## Test Coverage (critical paths)

| Path | Covered | Evidence |
|------|---------|----------|
| Validator fail-closed (count, tags, ids, opaque id, live id) | Yes | `korean-gold-validate.spec.ts` (10 tests) |
| Real fixture validates | Yes | CLI exit 0; adapter spec loads ko fixture |
| `--arm korean` CLI + FR-019 fail-closed | Yes | `agent-memory-benchmark.spec.ts` Korean arm block |
| FR-013 validate on benchmark load | Yes | `loadDataset` wiring + spec (Round 2) |
| `measure_only` + category by tags | Yes | Production + programmatic ko arm tests |
| English regression | Yes | Existing benchmark/adapter specs pass |
| LoCoMo remeasure | N/A | Blocked — no corpus |
| US4 paired comparison | N/A | Incomplete — by design |

---

## Edge Case / Brainstorm Coverage

| Edge case (spec) | Handled |
|------------------|---------|
| LoCoMo absent → no fake numbers | Yes — `remasure-locomo.md` blocked |
| Incomplete LoCoMo → no baseline promote | Yes — FR-018 doc |
| Empty relevantIds / unknown tags / duplicate id | Yes — validator + loadDataset gate |
| arm missing → error | Yes — `assertArmForFixture` |
| EN+KO mixed aggregate | Yes — separate arm keys |
| Single-sided #804/#807 snapshot | Yes — US4 incomplete status |
| Live DB IDs in gold | Yes — validator denylist |
| Measure-only vs numeric gate | Yes — `measure_only: true`; no #731 wiring |

---

## What Passed Strongly

- Synthetic Korean gold design: particle probes (`kq_001`/`kq_015` stem vs agglutinated corpus) align with #807 intent.
- Additive scorecard fields (`arm`, `measure_only`) preserve English contract (FR-011).
- `categoryBreakdownFromTags` satisfies FR-008 without taskCases.
- `.gitignore` adds `.local/korean-gold/`; `quality:korean-gold:validate` + `quality.ts` alias wired.
- Round 2 closes fail-closed gap: single validate gate on all scoring entry paths via `loadDataset`.
- `npm run lint`, `npm run type-check`, targeted vitest 44/44 (2026-08-31).

---

## Pre-merge Checklist

- [x] Fix `--arm korean` in `before-after-804-807.md` (Important #1)
- [x] Wire `validateKoreanGoldFixture` on ko fixture load (Important #2)
- [x] Complete redaction sign-off or PR attestation (Suggestion #3 — agent attestation; human re-confirm in PR)
- [ ] Run full `npm test` before push (not only targeted scripts)
- [ ] Do **not** commit `.local/` artifacts or LoCoMo bodies

---

## References

- Spec: [spec.md](./spec.md)
- Plan: [plan.md](./plan.md)
- Contracts: [korean-gold-fixture.md](./contracts/korean-gold-fixture.md), [scorecard-korean-arm.md](./contracts/scorecard-korean-arm.md)
- Blocked US1: [remasure-locomo.md](./remasure-locomo.md)
- Incomplete US4: [before-after-804-807.md](./before-after-804-807.md)
