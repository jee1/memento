# Code Review: Expand log_rotation Beyond Triple-Extraction (#852)

**Date**: 2026-09-06 | **Branch**: `feature/chore-ops-log_rotation-triple-extraction-migrati` | **Reviewer**: superspec review (`/speckit.superspec.review`)  
**Scope**: specs/672-852-log-rotation-expansion — `log-rotation*.ts`, `runLogRotation`, `log-rotation.spec.ts`, contract `log-rotation-job.md`

## Verdict: **PASS**

| Severity | Found | Fixed | Open |
|----------|-------|-------|------|
| Critical | 0 | 0 | 0 |
| Important | 3 | 3 | 0 |
| Suggestion | 2 | 0 | 2 |

리뷰 중 Important 3건은 코드·테스트에 수술적 수정 완료. `log-rotation.spec.ts` + `batch-scheduler-log-rotation.spec.ts` **13 passed**.

---

## Important (fixed during review)

### I-1. SC-001 / T006 high-churn fixture under-scoped (신뢰도 92)

**위치**: `packages/memento-core/src/infrastructure/logging/log-rotation.spec.ts` — migration high-churn test

**문제**: spec SC-001·tasks T006는 ≥1,000 in-window `migration_*.log` + **default** keepCount(500)를 요구. 구현 테스트는 seed=120, keepCount=50만 검증해 고 churn 스케일·기본 cap 회귀 증명이 약함.

**수정**: seed=1000, `DEFAULT_MIGRATION_KEEP_COUNT`(500) 사용, 명시 policy override 제거.

---

### I-2. T015 handler smoke 미구현 (신뢰도 90)

**위치**: `batch-scheduler-consolidation-relation-handlers.ts` — `runLogRotation`; tasks T015 marked done

**문제**: contract additive `details` shape·`processed`·`warnings` 매핑을 검증하는 handler/unit smoke가 없음. orchestrator 단위 테스트만으로 job 경계 계약 미확인.

**수정**: `batch-scheduler-log-rotation.spec.ts` 추가 — `rotateLogs` mock, `details.families`·policy 필드·`skippedMissingRoot` assert.

---

### I-3. Handler catastrophic path FR-007 절대경로 누출 (신뢰도 88)

**위치**: `batch-scheduler-consolidation-relation-handlers.ts:231-233` — `catch` → `errors.push(errorMessage)`

**문제**: orchestrator throw 시 원본 `Error.message`(파일시스템 절대경로 포함 가능)가 operator-facing `errors[]`에 그대로 노출. contract·FR-007 위반.

**수정**: `errors.push('log_rotation orchestration failed')` — 상세는 `ctx.log`만. handler spec으로 검증 추가.

---

## Suggestion (open)

### S-1. path-unsafe / symlink edge case 테스트 부재 (신뢰도 85)

**위치**: `log-rotation.ts` — `safePathUnderRoot`; spec Edge Cases

**문제**: `..`·separator·`\0` basename은 `path-unsafe` warn으로 skip하지만, symlink·traversal 시나리오에 대한 단위 테스트 없음. 구현은 `readdir` basename + `safePathUnderRoot`로 traversal 차단.

**권장**: temp root에 `../` 형태 basename mock 또는 symlink 픽스처로 warn·skip assert (플랫폼별 skip 허용).

---

### S-2. US1 soft-fail unlink 시나리오 테스트 부재 (신뢰도 82)

**위치**: spec US1 scenario 4; `rotateMigration` unlink catch

**문제**: per-file unlink 실패 시 job success + warning 기록은 코드에 있으나, mock/spy unlink 실패로 partial success를 assert하는 테스트 없음.

**권장**: `vi.spyOn(fs, 'unlink')` 선택적 reject로 warning·survivor count 검증.

---

## Spec compliance matrix

| ID | Result | Evidence |
|----|--------|----------|
| FR-001 four families | **PASS** | `rotateLogs` orchestrates migration, docker, monitor, TE |
| FR-002 migration count cap | **PASS** | keepCount sort+slice; keepCount≤0 disables cap |
| FR-003 docker byte budget | **PASS** | oldest-first delete until ≤ budget or one file left (data-model) |
| FR-004 TE age retention | **PASS** | `rotateTripleExtraction` + spec test |
| FR-005 monitor state.json | **PASS** | basename skip + trim jsonl |
| FR-006 soft-fail | **PASS** | per-file try/catch; handler `success: true` on completion |
| FR-007 no abs paths | **PASS** | `warn()` family:basename:detail; handler sanitized; `assertNoAbsTempLeak` |
| FR-008 env overrides | **PASS** | `LOG_ROTATION_*` + policies spec |
| FR-009 high-churn test | **PASS** (post I-1) | 1000-file fixture, default keepCount |
| FR-010 no unrelated delete | **PASS** | family selectors; non-migration files untouched test |
| SC-001–SC-005 | **PASS** | tests cover caps, age-only doc, TE, no path leak |
| Contract `details` | **PASS** (post I-2) | handler smoke |

## Constitution

| Gate | Result |
|------|--------|
| Test-first | **PASS** (post fixes) |
| No abs path leak | **PASS** (post I-3) |
| Soft-fail | **PASS** |
| Backward compat | **PASS** — job type unchanged; additive details |

## Security (path traversal)

| Check | Result |
|-------|--------|
| Basename-only join | **PASS** — `safePathUnderRoot` rejects separators, `..`, `\0` |
| No recursive wipe | **PASS** — known families only |
| Symlink explicit reject | **PARTIAL** — not rejected via `lstat`; symlink unlink removes link only (S-1) |

## Fixes applied (this review)

1. `log-rotation.spec.ts` — SC-001 fixture 1000 × default keepCount 500  
2. `batch-scheduler-log-rotation.spec.ts` — new handler contract smoke + FR-007 catch test  
3. `batch-scheduler-consolidation-relation-handlers.ts` — sanitized operator-facing error string

## Merge opinion

**조건부 승인 → PASS** — Critical/Important 0. Suggestion 2건은 후속 optional.
