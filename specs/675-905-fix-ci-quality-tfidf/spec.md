# Feature Specification: Nightly 품질 게이트가 잘못된 provider로 측정

**Feature Branch**: `feature/fix-ci-3-red-tfidf`
**Spec Directory**: `specs/675-905-fix-ci-quality-tfidf`
**Created**: 2026-09-06
**Status**: Executed — review PASS
**Issue**: [#905](https://github.com/jee1/memento/issues/905)
**Related**: [#812](https://github.com/jee1/memento/issues/812), [#889](https://github.com/jee1/memento/issues/889), [#890](https://github.com/jee1/memento/issues/890), [#731](https://github.com/jee1/memento/issues/731)
**Input**: fix(ci): 나이틀리 품질 게이트가 3주 연속 red — 게다가 프로덕션이 쓰지 않는 tfidf 로 측정한다

## Problem Statement

Nightly Tests `Gate category search quality (MRR >= 0.5)` 가 2026-08-23부터 3주 연속 실패한다.
실패 로그의 1순위 원인은 `#812` 이후 `scripts/lib/benchmark-search-database.ts` 가
`@memento/core` (dist) 를 import 하는데 `test-search-quality` 잡에 **core build 스텝이 없어**
`ERR_MODULE_NOT_FOUND` 로 즉시 죽는 것이다. MRR 게이트까지 도달하지 못한다.

동시에 category-report 시드/검색은 **의도적으로** `tfidf`(+`mock`) 에 하드코딩되어 있어
`EMBEDDING_PROVIDER`(프로덕션 기본 `minilm`) 와 무관하다. 리포트는 측정 provider/차원을
출력하지 않아, green/red가 프로덕션 검색 품질을 의미하지 않는 가짜 신호였다.
이슈의 “CI는 DB_PATH 빈 DB, 로컬은 프로덕션 DB” 가설은 틀렸다 —
양쪽 모두 `tests/fixtures/search-quality/benchmark-v3` 코퍼스를 임시 SQLite에 시드한다.

## Goals

- Nightly `test-search-quality` 가 category-report 전에 `@memento/core` 를 빌드한다.
- category-report stdout 헤더에 **실제 시드·검색에 쓴** embedding provider 와 벡터 차원을 출력한다.
- 벤치마크 시드/검색 provider 는 `EMBEDDING_PROVIDER`(미설정 시 설정 기본=`minilm`) 를 따른다.
  tfidf+mock 고정 오프라인 베이스라인은 제거한다(프로덕션 정렬).
- 워크플로 주석으로 category-report 가 `DB_PATH` 가 아닌 fixture 코퍼스임을 명시한다.
- MRR 임계값 `0.5` 는 유지한다. provider 정렬 후 red면 실제 품질 신호로 취급한다.

## Non-Goals

- 프로덕션 DB / `DB_PATH` 로 category-report 를 돌리는 모드 추가.
- MRR 임계값 수치의 사전 재보정(데이터 없이 값만 바꾸기).
- `ONNXRUNTIME_NODE_INSTALL=skip` 정책 변경 (#890 유지).
- LoCoMo / 한국어 gold / weekly category-report 범위 확장.
- 운영 DB 의 잔여 tfidf 행 정리 마이그레이션.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nightly가 category-report를 실행할 수 있다 (Priority: P1)

CI 러너가 `npm ci` 직후 `@memento/core` 를 빌드한 뒤 category-report 를 실행한다.
모듈 로드 실패로 게이트가 죽지 않는다.

**Why this priority**: 3주 red의 직접 원인. 측정 자체가 안 되는 상태.

**Independent Test**: 워크플로에 `build -w @memento/core` 스텝 존재; 로컬에서
`rm -rf packages/memento-core/dist && npm run build -w @memento/core &&
npm run quality -- benchmark category-report` 가 모듈 에러 없이 진행.

**Acceptance Scenarios**:

1. **Given** `test-search-quality` job, **When** category-report 직전, **Then** `npm run build -w @memento/core` 가 실행된다.
2. **Given** clean checkout after `npm ci` + core build, **When** category-report, **Then** `ERR_MODULE_NOT_FOUND` for `@memento/core/dist` 가 발생하지 않는다.

---

### User Story 2 - 리포트가 측정 provider를 드러낸다 (Priority: P1)

category-report 출력 상단에 시드·검색에 사용한 embedding provider 이름과 벡터 차원이 보인다.

**Why this priority**: 이슈 완료조건 #1. 가짜 신호 탐지 가능해야 한다.

**Independent Test**: 스크립트/헬퍼 단위 테스트로 헤더 포맷 고정; 실행 stdout에
`embedding_provider=` 및 `vector_dims=` 포함.

**Acceptance Scenarios**:

1. **Given** 시드 provider `minilm` (384), **When** category-report 출력, **Then** 헤더에 provider=`minilm` 과 dims=`384` 가 포함된다.
2. **Given** 시드 provider `tfidf` (테스트용), **When** 헤더 포맷, **Then** 동일 키로 provider/dims 가 출력된다.

---

### User Story 3 - 게이트가 프로덕션과 같은 provider로 측정한다 (Priority: P1)

시드와 `provider_filter` 가 `EMBEDDING_PROVIDER`(또는 설정 기본값 `minilm`) 를 사용한다.
하드코딩 `tfidf`/`mock` 페어는 제거한다.

**Why this priority**: 이슈 완료조건 #2. 게이트가 프로덕션 검색과 같은 벡터 공간을 본다.

**Independent Test**: `EMBEDDING_PROVIDER=minilm` 시 시드 행이 minilm만; aggregator
filter 가 동일 provider; `EMBEDDING_PROVIDER=tfidf` 테스트는 빠른 회귀용으로만 유지.

**Acceptance Scenarios**:

1. **Given** `EMBEDDING_PROVIDER=minilm` (또는 unset→config default minilm), **When** seed, **Then** embeddings 는 minilm 이고 tfidf/mock 강제 시드가 없다.
2. **Given** 동일 provider, **When** category metrics search, **Then** `provider_filter` 가 그 provider 만 포함한다.
3. **Given** Nightly workflow, **When** category-report 실행, **Then** `EMBEDDING_PROVIDER=minilm` 이 job/env 에 명시된다.

---

### User Story 4 - 코퍼스 전제가 워크플로에 적힌다 (Priority: P2)

Nightly 워크플로 주석이 category-report 가 fixture 코퍼스 임시 DB 를 쓰며
`DB_PATH` 와 무관함을 명시한다.

**Why this priority**: 이슈 걸림돌 #1 해소. 운영 혼동 방지.

**Independent Test**: `.github/workflows/nightly-tests.yml` 주석 리뷰.

**Acceptance Scenarios**:

1. **Given** `test-search-quality` job, **When** 워크플로 읽기, **Then** fixture `benchmark-v3` / `DB_PATH` 미사용이 주석으로 보인다.

### Edge Cases

- minilm ONNX 로드 실패 시: 시드가 명확한 에러로 실패(조용한 tfidf 폴백 금지).
- `EMBEDDING_PROVIDER` 가 유효하지 않으면: 기존 config 파서 경고/기본 동작; 벤치마크는 해석된 provider 를 헤더에 출력.
- 코퍼스 시드 벽시계는 WALL_MS(SC-006) 제외 — 기존 계약 유지. minilm 시드가 길어도 post-seed 집계만 30s 제한.
- mock 임베딩 제거로 alpha 교차-provider 측정은 본 게이트 범위 밖(Non-Goal).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Nightly `test-search-quality` MUST run `npm run build -w @memento/core` before category-report.
- **FR-002**: category-report MUST print embedding provider and vector dimension used for the run in the report header.
- **FR-003**: Benchmark seed MUST store embeddings for the resolved `EMBEDDING_PROVIDER` (config default `minilm` when unset); MUST NOT hard-require tfidf.
- **FR-004**: Category quality search MUST set `provider_filter` to the same resolved provider used for seeding (not a fixed `['tfidf','mock']` list).
- **FR-005**: Nightly workflow MUST set `EMBEDDING_PROVIDER=minilm` for the quality gate job (or workflow env).
- **FR-006**: Nightly workflow MUST document that category-report uses `tests/fixtures/search-quality/benchmark-v3`, not `DB_PATH`.
- **FR-007**: Seed MUST fail closed if the requested provider cannot embed (no silent fallback to another provider).
- **FR-008**: MRR gate threshold remains `0.5` unless a follow-up recalibration issue is opened with measured minilm baselines.

### Key Entities

- **Benchmark seed run**: temporary SQLite + embedding rows tagged by provider + dims.
- **Category quality report header**: human-readable provider/dims metadata before the MRR table.
- **Offline corpus**: `benchmark-v3` fixture (immutable for this issue).

## Success Criteria *(mandatory)*

- **SC-001**: Nightly `Gate category search quality` no longer fails with `@memento/core/dist` `ERR_MODULE_NOT_FOUND`.
- **SC-002**: category-report stdout includes provider and vector dims for the measured run.
- **SC-003**: With production-aligned provider (`minilm`), seed+search use that provider only.
- **SC-004**: Gate is green, OR red with MRR table produced under minilm (failure is real quality, not infra).
- **SC-005**: Automated tests cover provider-respecting seed behavior and header formatting.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | category-report corpus = fixture or DB_PATH? | Resolved | Fixture `benchmark-v3` only; document in workflow |
| Q2 | Keep tfidf+mock offline baseline? | Resolved | Remove hardcode; align to `EMBEDDING_PROVIDER`/`minilm` |
| Q3 | Keep companion mock embeddings? | Resolved | No — single provider matching production |
| Q4 | Change MRR threshold now? | Resolved | Keep 0.5; recalibrate only with measured data (follow-up) |
| Q5 | ONNX skip vs minilm? | Resolved | Keep `ONNXRUNTIME_NODE_INSTALL=skip`; CPU onnxruntime bundle sufficient (#890) |

## Brainstorm Log

### 2026-09-06 — Session 1 (auto-select recommended)

- Root-cause split: infra (missing core build post-#812) vs product (tfidf hardcode).
- Issue text wrong on DB_PATH vs fixture; correct in Goals/US4.
- Auto-selected Q1–Q5 as above (production alignment over fast tfidf baseline).
- Status → Brainstormed; proceed plan/tasks/execute.
