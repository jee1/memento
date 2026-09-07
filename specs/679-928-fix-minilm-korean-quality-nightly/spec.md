# Feature Specification: MiniLM 한국어 품질 회귀가 Nightly에서 실행되지 않음 (#928)

**Feature Branch**: `feature/minilm`  
**Spec Directory**: `specs/679-928-fix-minilm-korean-quality-nightly`  
**Created**: 2026-09-07  
**Status**: Executed — review PASS  
**Issue**: [#928](https://github.com/jee1/memento/issues/928)  
**Related**: [#889](https://github.com/jee1/memento/issues/889) (테스트 추가), [#905](https://github.com/jee1/memento/issues/905) (nightly quality job), tech-debt TD-20260907-005  
**Input**: MiniLM 한국어 품질 회귀 테스트가 `RUN_EMBEDDING_QUALITY=1` opt-in이지만 workflow가 활성화하지 않아 CI에서 4개 전부 skip·exit 0

## Problem Statement

`#889` 에서 추가한 `minilm-korean-quality.spec.ts` 는 실제 multilingual MiniLM(~118MB q8 onnx)을
내려받아야 해서 `RUN_EMBEDDING_QUALITY === '1'` 일 때만 `describe` 가 활성화된다.
어떤 GitHub workflow도 이 환경변수를 켜지 않으므로, 파일을 직접 실행해도
**Test Files 1 skipped / Tests 4 skipped / exit 0** 이 된다.
한국어 관련성·교차 언어·무관 문서 임계값 퇴행이 자동 검증에서 보이지 않는다.

## Goals

- 주간 Nightly workflow에서 해당 스펙 4개 테스트가 **skip 없이** 실행된다.
- 테스트 실패는 workflow job 실패로 전파된다(exit ≠ 0).
- 모델 다운로드는 Hugging Face 캐시로 완화하고, job timeout(기존 45분) 안에 든다.
- YAML·대상 명령을 계약 테스트로 검증한다.
- PR마다 모델 다운로드를 강제하지 않는다(opt-in 로컬 + weekly nightly만).

## Non-Goals

- `minilm-korean-quality.spec.ts` 의 코퍼스·임계값(0.38)·단언 로직 변경.
- PR CI / `ci.yml` 에 품질 회귀를 넣는 것.
- `ONNXRUNTIME_NODE_INSTALL=skip` 정책 변경(#890).
- LoCoMo / 한국어 gold(#808) / category-report 범위 확장.
- 프로덕션 DB 경로로 품질 테스트 실행.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nightly가 한국어 품질 회귀를 실제로 돌린다 (Priority: P1)

운영/유지보수자가 주간 Nightly를 돌리면 MiniLM 한국어 품질 4개 테스트가 skip 없이 실행된다.

**Why this priority**: 이슈 핵심 — 현재는 “성공”이지만 검증이 없다.

**Independent Test**: `nightly-tests.yml` 에 `RUN_EMBEDDING_QUALITY=1` 과 스펙 경로가 있고,
로컬에서 동일 env로 vitest 실행 시 4 tests not skipped.

**Acceptance Scenarios**:

1. **Given** Nightly `test-search-quality` job, **When** MiniLM Korean quality step runs, **Then** `RUN_EMBEDDING_QUALITY=1` 이 설정된다.
2. **Given** 동일 step, **When** vitest 대상이 `minilm-korean-quality.spec.ts`, **Then** 수집·실행 테스트 수가 4이며 skip-only로 끝나지 않는다.

---

### User Story 2 - 실패가 게이트를 깨뜨린다 (Priority: P1)

품질 단언이 실패하면 Nightly job이 실패하고 결과 아티팩트 업로드 경로가 기존과 같다.

**Why this priority**: skip→green 보다 위험한 것은 fail→green이다. 실패 전파가 필수.

**Independent Test**: step이 `continue-on-error` 없이 vitest `--run` 을 직접 호출; failure 시 upload-artifact `if: failure()` 유지.

**Acceptance Scenarios**:

1. **Given** quality step fails (non-zero vitest), **When** job 완료, **Then** job status = failure.
2. **Given** job failure, **When** upload step, **Then** 기존 `nightly-search-quality-results` 경로가 동작한다(`continue-on-error: true` on upload only).

---

### User Story 3 - 모델 비용이 PR을 치지 않고 Nightly timeout 안에 든다 (Priority: P2)

PR workflow는 이 스펙을 강제하지 않는다. Nightly는 HF 모델 캐시를 써서 반복 다운로드를 줄인다.

**Why this priority**: 이슈 제안 — PR마다 118MB를 받지 말 것; cache로 시간 예산 충족.

**Independent Test**: `ci.yml` 에 `RUN_EMBEDDING_QUALITY` / korean-quality 스펙 없음; Nightly에 `actions/cache` for HF home.

**Acceptance Scenarios**:

1. **Given** PR `ci.yml`, **When** 검사, **Then** `minilm-korean-quality.spec.ts` 강제 실행 스텝이 없다.
2. **Given** Nightly job, **When** 모델 step 전, **Then** Hugging Face cache restore가 있다(miss 시 download, hit 시 reuse).

---

### User Story 4 - 워크플로 계약이 깨지면 단위 테스트가 잡는다 (Priority: P2)

유지보수자가 YAML에서 env/스펙 경로를 지우면 리포지토리 계약 테스트가 실패한다.

**Why this priority**: 이슈 완료조건 “YAML 및 대상 명령 검증”.

**Independent Test**: `tests/test-topology-contract.spec.ts`(또는 동등)가 nightly YAML에
`RUN_EMBEDDING_QUALITY` 와 스펙 경로를 assert.

**Acceptance Scenarios**:

1. **Given** `nightly-tests.yml`, **When** topology contract runs, **Then** `RUN_EMBEDDING_QUALITY` 와 `minilm-korean-quality.spec.ts` 문자열이 존재한다.

---

### Edge Cases

- `RUN_EMBEDDING_QUALITY` 가 `'1'` 이 아닌 값(`true`, `yes`) → 기존과 같이 skip (변경 없음); Nightly는 반드시 `'1'`.
- 모델 다운로드 네트워크 실패 → vitest/job fail (fail-closed; skip으로 위장하지 않음).
- vitest 전역 mock(`@huggingface/transformers`, `onnxruntime-node`) → 스펙 파일의 `vi.unmock` 유지.
- `test-heavy` job과의 중복 실행 → 하지 않음; `test-search-quality` 한 곳만.
- job timeout 45분 유지; 캐시 miss + category-report + quality 합이 초과하면 timeout으로 fail(별도 timeout 상향은 Non-Goal 우선, 필요 시 follow-up).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.github/workflows/nightly-tests.yml` 의 `test-search-quality` job에 MiniLM 한국어 품질 실행 스텝이 있어야 한다.
- **FR-002**: 해당 스텝은 `RUN_EMBEDDING_QUALITY=1` 과 스펙 경로
  `packages/memento-core/src/domains/embedding/services/__tests__/minilm-korean-quality.spec.ts` 로 vitest `--run` 을 호출해야 한다.
- **FR-003**: 스텝은 `continue-on-error` 없이 실패를 job에 전파해야 한다.
- **FR-004**: Nightly job은 Hugging Face 모델 캐시(`actions/cache`, 경로 `~/.cache/huggingface`)를 복원/저장해야 한다.
- **FR-005**: PR CI(`ci.yml`)는 이 스펙을 강제 실행하지 않아야 한다.
- **FR-006**: 리포지토리 계약 테스트가 Nightly YAML에 `RUN_EMBEDDING_QUALITY` 와 스펙 파일명을 검증해야 한다.
- **FR-007**: 기존 `ONNXRUNTIME_NODE_INSTALL: skip`, `EMBEDDING_PROVIDER: minilm`, core build, category-report 스텝은 유지한다.

### Key Entities

- **Quality gate env**: `RUN_EMBEDDING_QUALITY` (`'1'` = enable).
- **Nightly job**: `test-search-quality`.
- **HF model cache**: `~/.cache/huggingface` (transformers.js / Xenova models).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nightly 한국어 품질 스텝에서 vitest가 4 tests 실행(0 skipped for that file) 가능.
- **SC-002**: 의도적 단언 실패 시 job non-zero (continue-on-error 없음).
- **SC-003**: HF cache step 존재; job `timeout-minutes` ≤ 45 유지.
- **SC-004**: topology/contract 테스트가 YAML·명령 문자열을 검증하고 통과.
- **SC-005**: `simplify` 관점 — 새 잡/새 npm 스크립트 없이 기존 job에 스텝+캐시+계약 assert만 추가.

## Assumptions

- `test-search-quality` 가 MiniLM을 이미 쓰므로(category-report) 동일 job에 붙이는 것이 캐시·env 재사용에 유리하다.
- 로컬 기본은 계속 skip(opt-in); Nightly만 enable.
- `tech-debt-pending` → PR 전 `tech-debt-approved` 라벨 교체는 운영 절차(구현과 별도).
- constitution 변경 없음(I/IV가 계약 테스트·품질 게이트로 충분).

## Brainstorm Log

### 2026-09-07 — Session 1 (canonical auto-select Recommended)

Issue acceptance criteria complete; interview skipped per prior Speckit pattern for well-specified tech-debt CI wiring.

| # | Question | Recommended | Resolution |
|---|----------|-------------|------------|
| 1 | New job vs existing? | Add step to `test-search-quality` | Adopted — reuse minilm env/build/ONNX skip |
| 2 | HF cache? | `actions/cache` on `~/.cache/huggingface` | Adopted — FR-004 |
| 3 | Detect skip-only green? | Env=`1` + contract test; vitest fail-closed on assert | Adopted — no fragile stdout parser |
| 4 | PR CI enable? | No | Adopted — FR-005 / Non-Goal |
| 5 | Change test thresholds? | No | Adopted — Non-Goal |
| 6 | Duplicate on `test-heavy`? | No | Adopted — single owner job |

**Verdict**: `BRAINSTORM_COMPLETE` → Status Brainstormed. Next: `/speckit.plan`.

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| 1–6 | See brainstorm table | Resolved | Recommended adopted |
