# Tasks: triple predicate 정규화 게이트 (#813)

**Input**: Design documents from `/specs/664-813-predicate-normalization/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md)
**Branch**: `fix-semantic-triple-2026-08-11.6-predicate`
**Issue**: [#813](https://github.com/jee1/memento/issues/813)

**Tests**: Constitution Principle I — RED → GREEN → REFACTOR 필수. 결함 수정이므로 구조 리팩터 예외 없음.

## Format: `[ID] [Markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 다른 파일·무의존 → 병렬 가능 |
| `[TDD]` | RED → GREEN → REFACTOR 필수 |
| `[REVIEW]` | 다음 단계 전 사람/리뷰 게이트 |
| `[SUBAGENT]` | 서브에이전트 위임 가능 |

## Global Constraints (모든 작업에 적용)

- Node.js ≥24, TypeScript ESM, npm workspaces — 변경은 `@memento/core` + `scripts/` + 루트 `package.json`
- **스키마 마이그레이션 없음** (`kg_triple` / `memory_item` DDL 금지)
- **MCP 계약 불변** (FR-008): recall/remember 스키마·검색 응답 형태 변경 금지
- **백필 금지** (OQ-4): 기존 형태 (2) / 오염 `kg_triple` 일괄 rewrite 없음
- **헤드워드 휴리스틱 금지**; `conjugatePredicate` 영문·구 규칙 추가 금지
- AGENTS #768: `buildTripleSentence()`만 사용; canonical에 `합니다` 덧붙이기 금지
- **픽스처는 합성만** (FR-010); 라이브 DB 스냅샷·실사용자 본문 커밋 금지
- CI는 게이트 경로 형태 (2) **0%**만 강제 (SC-001); 라이브 <1%(SC-006)는 ops 목표·CI assert 금지
- `graphify-out/` 커밋 금지

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 기준선 확인 및 플랜 파일 인벤토리 고정

- [x] **T001** 기존 관련 스펙 green 기준선 확인

  **Files**: 없음(읽기 전용)

  ```bash
  npm test -- \
    packages/memento-core/src/domains/relation/services/triple-extraction/__tests__/triple-normalizer.spec.ts \
    packages/memento-core/src/domains/relation/services/triple-extraction/predicate-canonicalizer.spec.ts \
    packages/memento-core/src/domains/memory/semantic/triple-sentence.spec.ts
  ```

  Expected: PASS (현재 pass-through 기대값 유지). 실패 시 먼저 환경(`npm install` / build) 점검.

- [x] **T002** `[P]` 플랜 경로 인벤토리·수정 금지 목록 확인

  **Files** (존재 확인만):
  - `packages/memento-core/src/domains/relation/services/triple-extraction/triple-normalizer.ts`
  - `packages/memento-core/src/domains/relation/services/triple-extraction/interfaces.ts`
  - `packages/memento-core/src/shared/types/triple-extraction.ts`
  - `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.ts`
  - `packages/memento-core/src/domains/memory/semantic/{episodic-semantic-conversion,triple-extraction-metadata,semantic-memory-crud,semantic-memory-scoring,triple-sentence}.ts`
  - CLI 미러: `scripts/lib/db-residue.ts`, `package.json` scripts

  **Do not modify (v1)**: `predicate-canonicalizer.ts` 사전 확장, `triple-sentence.ts` 활용 규칙, MCP tool schemas, migrations, #804 FR-001b.

**Checkpoint**: 기준선 green · 파일 맵 확정 → Foundational 시작 가능

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 게이트·추출·CLI가 공유하는 skip/report 타입을 한곳에 둔다

**⚠️ CRITICAL**: T003–T004 완료 전에는 US1/US2/US3 구현을 시작하지 않는다 (테스트 초안 작성만 예외적으로 가능하나 import 대상 타입은 T003 산출물을 쓴다).

- [x] **T003** `[TDD]` `[SUBAGENT]` `PredicateSkipReason` / `PredicateSkip` / `NormalizeWithReportResult` + `ExtractionInfo` additive 필드 타입 추가

  **Files**:
  - Modify: `packages/memento-core/src/shared/types/triple-extraction.ts`
  - Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/interfaces.ts`
  - Test: 타입 소비 스펙은 T005에서 RED로 검증; 필요 시 최소 타입-only import smoke

  **Produces** ([data-model.md](./data-model.md)):
  ```ts
  type PredicateSkipReason =
    | 'predicate_empty'
    | 'predicate_canonicalize_failed'
    | 'predicate_reassembly_failed';
  interface PredicateSkip { index: number; predicate: string; reason: PredicateSkipReason }
  interface NormalizeWithReportResult { triples: Triple[]; skips: PredicateSkip[] }
  // ExtractionInfo additive: predicateSkips?, predicateSkipCounts?
  ```

  **Trace**: FR-007 reason 집합 · FR-001/002 게이트 계약 · FR-008(내부 additive만)

- [x] **T004** `[REVIEW]` data-model ↔ interfaces 정합 리뷰 게이트

  확인: reason 코드 3종만, OOV 규칙(공백 없음+한글 종결+재조립)이 타입/주석에 반영, MCP 공개 스키마 미노출.

**Checkpoint**: Foundation ready — US1·US2 병렬 시작 가능. US3는 US1 추출 배선(T008) 이후.

---

## Phase 3: User Story 1 — 정규화 실패 predicate는 semantic으로 저장되지 않는다 (Priority: P1) 🎯 MVP

**Goal**: `TripleNormalizer`에서 비canonical/재조립불가 predicate를 drop하고, 수용분만 semantic/`kg_triple`에 persist (형태 (2) 폴백 0건)

**Independent Test**: 합성 fixture(구·영문·canonical·OOV 한글·재조립 null)로 normalize→extract→persist 시 bad predicate는 skip reason과 함께 제외되고 form-(2) content / bad `kg_triple`가 0건

**Trace**: FR-001, FR-002, FR-003, FR-004 · SC-001, SC-002 · US1 AS1–AS5

### Tests for User Story 1 (REQUIRED) ⚠️

> Write / rewrite tests FIRST; ensure they FAIL before implementation

- [x] **T005** `[P]` `[TDD]` `[SUBAGENT]` `[US1]` `triple-normalizer.spec.ts`에 FR-001 시나리오 RED 작성

  **Files**:
  - Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/__tests__/triple-normalizer.spec.ts`

  **Cases** (합성 predicate만):
  1. `관련 작업` → drop `predicate_canonicalize_failed`
  2. `use` (사전 미매칭) → drop; 사전 매칭 시 → `사용함`
  3. `사용함` → accept + 재조립 가능
  4. `배포함` OOV 한글 단일 토큰 + 재조립 OK → accept
  5. 한글 종결이나 `buildTripleSentence` null → `predicate_reassembly_failed`
  6. empty/whitespace → `predicate_empty`
  7. mixed batch → partial accept + skips
  8. **삭제/교체**: 기존 “unknownPredicate kept”(pass-through) 기대

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/triple-extraction/__tests__/triple-normalizer.spec.ts
  ```
  Expected: RED (pass-through 잔존)

### Implementation for User Story 1

- [x] **T006** `[TDD]` `[SUBAGENT]` `[US1]` `normalizeWithReport` 게이트 구현 + `normalize`는 accepted만 반환

  **Files**:
  - Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-normalizer.ts`
  - Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/interfaces.ts` (필요 시)
  - Consume: `buildTripleSentence` from `packages/memento-core/src/domains/memory/semantic/triple-sentence.ts`
  - Do **not** modify conjugation rules in `triple-sentence.ts`

  **Gate order** (plan Architecture):
  1. empty → `predicate_empty`
  2. canonicalize OK → reassembly OK? accept canonical : `predicate_reassembly_failed`
  3. canonicalize FAIL → Hangul single-token(no space)+reassembly OK? accept OOV : phrase/Latin → `predicate_canonicalize_failed` / reassembly-null → `predicate_reassembly_failed`

  **Invariant**: `success ? canonical : triple.predicate` pass-through **삭제**

  Verify: T005 GREEN

- [x] **T007** `[TDD]` `[SUBAGENT]` `[US1]` `[REVIEW]` TripleExtractionService가 report를 접고 accepted만 전달

  **Files**:
  - Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.ts`
  - Modify/Create colocated service spec under `.../triple-extraction/` (기존 패턴 따름)
  - Types: `packages/memento-core/src/shared/types/triple-extraction.ts` (`predicateSkips` / counts)

  **Produces**: `ExtractionInfo`에 skips·counts; `result.triples` = accepted only; structured log reason (FR-007 일부)

  **Depends on**: T006

- [x] **T008** `[TDD]` `[SUBAGENT]` `[US1]` 게이트 경로 form-(2)·bad `kg_triple` 0건 persist 스펙

  **Files** (기존 하네스 우선):
  - Prefer: `packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts` 및/또는 quality-persistence / CRUD 통합 스펙
  - Touch only if needed: `semantic-memory-crud.ts` (게이트 통과 목록만 소비 — 별도 게이트 중복 금지)

  **Assert**:
  - phrase/Latin → semantic content ≠ episodic fallback (형태 (2) 0) · `kg_triple` 비한글/미게이트 0 (SC-001/002)
  - canonical / OOV Hangul → `buildTripleSentence` 문장만 content

  **Depends on**: T006–T007 (추출→persist 경로)

**Checkpoint**: US1 MVP — 신규 게이트 경로에서 형태 (2) 유입 차단 검증 가능. US3 soft-success 전에도 drop 동작은 독립 검증됨.

---

## Phase 4: User Story 2 — 운영자가 predicate 품질을 CLI로 관측한다 (Priority: P1)

**Goal**: read-only `npm run memory:kg-triple-predicate-quality`로 `kg_triple` predicate 품질 집계·캡 샘플

**Independent Test**: 합성 DB에 한글 종결 9 + 비한글 1 → rate≈0.9, 행 수 불변, stdout에 절대 DB 경로·전수 ID 없음

**Trace**: FR-005, FR-006, FR-010 · SC-003 · US2 AS1–AS2

**Note**: Foundational(T003) 완료 후 **US1과 병렬 가능** (코어 게이트 파일과 겹치지 않음)

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] **T009** `[P]` `[TDD]` `[SUBAGENT]` `[US2]` pure report builder 스펙 RED→GREEN

  **Files**:
  - Create: `scripts/lib/kg-triple-predicate-quality.ts`
  - Create: `scripts/kg-triple-predicate-quality.spec.ts` (또는 `scripts/lib/kg-triple-predicate-quality.spec.ts`)

  **Produces** ([data-model.md](./data-model.md)):
  `KgTriplePredicateQualityReport` — `total`, `hangul_termination_rate`, `whitespace_rate`, `average_length`, `non_hangul_termination_count`, capped `samples`

  Mirror style: `scripts/lib/db-residue.ts` / `scripts/lib/db-residue.spec.ts`

  ```bash
  npm test -- scripts/kg-triple-predicate-quality.spec.ts
  ```

### Implementation for User Story 2

- [x] **T010** `[P]` `[TDD]` `[SUBAGENT]` `[US2]` CLI 엔트리 + npm script

  **Files**:
  - Create: `scripts/kg-triple-predicate-quality.ts`
  - Modify: `package.json` — `"memory:kg-triple-predicate-quality": "tsx scripts/kg-triple-predicate-quality.ts"`

  Output: `{ ok: true, report }` JSON; optional `--sample-limit` (default ≤20)

- [x] **T011** `[P]` `[TDD]` `[US2]` 읽기전용·FR-006 보안 단언

  **Files**: same CLI spec as T009/T010

  **Assert**: report 전후 `kg_triple` COUNT 동일; stdout에 abs `DB_PATH` 없음; sample 상한; 합성 fixture만

**Checkpoint**: US2 독립 완료 — quickstart §1 명령이 동작해야 함

---

## Phase 5: User Story 3 — 정규화 실패가 관측 가능하며 부분 성공한다 (Priority: P2)

**Goal**: skip reason·카운터가 metadata/로그에 남고, 일부/전부 게이트 실패해도 primary remember/변환 경로가 하드 실패하지 않음

**Independent Test**: 혼합/전부-skip fixture → 성공 triple만 persist, skip aggregates 기록, 전부 skip이어도 `buildFailureOutcome`/`no_triple`로 뒤집지 않음; recall 계약 유지

**Trace**: FR-007, FR-009 · SC-007, SC-005 · US3 AS1–AS2 · OQ-5/OQ-7

**Depends on**: Phase 3 T007 (ExtractionInfo skips). LLM true-empty / parse-fail 기존 실패 경로는 유지 (Decision 5).

### Tests for User Story 3 (REQUIRED) ⚠️

- [x] **T012** `[P]` `[TDD]` `[SUBAGENT]` `[US3]` `buildTripleExtractionSuccessMetadata` skip 집계 RED

  **Files**:
  - Modify: `packages/memento-core/src/domains/memory/semantic/triple-extraction-metadata.ts`
  - Test: colocated / existing metadata spec under `packages/memento-core/src/domains/memory/semantic/`

  **Keys**: `predicate_skip_count`, `predicate_skip_reasons` (Partial\<Record\<PredicateSkipReason, number\>\>); all-skip → `triple_count: 0` + non-zero skips

### Implementation for User Story 3

- [x] **T013** `[TDD]` `[SUBAGENT]` `[US3]` `convertEpisodicSource` 게이트-전부-필터 soft success

  **Files**:
  - Modify: `packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts`
  - Test: conversion specs under `packages/memento-core/src/domains/memory/semantic/`

  **Behavior**:
  - accepted ≥ 1 → persist 성공분 + skip metadata
  - LLM returned ≥1 but all gated → soft success + skip metadata (**not** `no_triple` hard fail)
  - true LLM/parse empty → existing failure unchanged
  - #805 CAS / remember primary path 비중단 (FR-009)

- [x] **T014** `[TDD]` `[US3]` `[REVIEW]` 부분 성공 + reason 관측 통합 검증 (SC-007)

  **Files**: conversion + extraction specs (T007/T012/T013)

  **Assert**: reason ∈ `{predicate_empty, predicate_canonicalize_failed, predicate_reassembly_failed}`만; 주 경로 성공; MCP 스키마 불변(FR-008 / SC-005 스모크가 있으면 실행)

**Checkpoint**: US1+US2+US3 모두 독립적으로 기능. Polish로 이동.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 문서·품질 게이트·graphify

- [x] **T015** `[P]` `[SUBAGENT]` [quickstart.md](./quickstart.md) 명령·스크립트명과 구현 일치 검증

  ```bash
  # dry: script exists
  npm run memory:kg-triple-predicate-quality -- --help 2>/dev/null || true
  npm test -- scripts/kg-triple-predicate-quality.spec.ts
  ```

- [x] **T016** `[P]` 선택: CHANGELOG 및/또는 `AGENTS.md` §3.1에 CLI·게이트 한 줄 gotcha (최소)

  **Files**: `CHANGELOG.md` and/or `AGENTS.md` — 요청/관례에 맞을 때만

- [x] **T017** Quality gates (Constitution IV / SC-004)

  ```bash
  npm run lint && npm run type-check
  npm test -- \
    packages/memento-core/src/domains/relation/services/triple-extraction \
    packages/memento-core/src/domains/memory/semantic \
    scripts/kg-triple-predicate-quality.spec.ts
  ```

- [x] **T018** Graphify gate (Constitution IV) — production code 변경 후

  ```bash
  python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
  # confirm graphify-out/GRAPH_REPORT.md exists; do NOT commit graphify-out/
  ```

- [x] **T019** `[REVIEW]` 완료 전 체크: Non-Goals 준수 · FR-008 · SC-006은 CI에 넣지 않음 · `/speckit.superspec.review` 준비

**Checkpoint**: 핸드오프 가능 — execute/review 단계로

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 Setup
    ↓
Phase 2 Foundational (T003–T004)  ── BLOCKS all stories
    ↓
    ├─► Phase 3 US1 (P1 MVP)     T005→T006→T007→T008
    ├─► Phase 4 US2 (P1)         T009∥T010∥T011   [parallel with US1 after Foundational]
    └─► Phase 5 US3 (P2)         T012→T013→T014   [after T007]
    ↓
Phase 6 Polish (T015–T019)
```

- **Setup**: 의존 없음
- **Foundational**: Setup 후 · **모든 US 차단**
- **US1 / US2**: Foundational 후 병렬 가능 (파일 충돌 없음)
- **US3**: T007(ExtractionInfo skips) 이후
- **Polish**: 원하는 US 완료 후 (MVP만이면 US1+최소 Polish도 가능하나 CLI(US2)는 P1이라 함께 권장)

### User Story Dependencies

| Story | Priority | Start after | Depends on other stories |
|-------|----------|-------------|--------------------------|
| US1 | P1 MVP | Foundational | 없음 |
| US2 | P1 | Foundational | 없음 (게이트와 독립) |
| US3 | P2 | T007 | US1 추출 배선(스킵 전달) |

### Within Each Story

- Tests RED before GREEN (`[TDD]`)
- Types (T003) before normalizer before service before persist/conversion
- Commit은 사용자 요청 시에만

### Parallel Opportunities

| Group | Tasks | Why safe |
|-------|-------|----------|
| Setup | T002 ∥ (after T001) | 읽기 전용 인벤토리 |
| US1 tests vs US2 | T005 ∥ T009 | 서로 다른 파일 |
| US2 cluster | T009, T010, T011 `[P]` | `scripts/` + `package.json`만 (T010이 package.json이면 T009 완료 후 T010→T011 순 권장; builder/CLI 파일 분리는 병렬) |
| US1 persist vs US2 | T008 ∥ T010/T011 | core vs scripts |
| US3 metadata vs (done US2) | T012 ∥ (US2 already done) | metadata vs scripts |
| Polish docs | T015 ∥ T016 | 문서·검증 |

**`[P]` + `[SUBAGENT]` parallelizable set**: T002, T005, T009, T010, T011, T012, T015, T016 (의존 만족 시). 코어 시퀀스 T006→T007→T008·T013은 순차.

---

## Parallel Example

```bash
# After Foundational (T003–T004):
# Agent A — US1 gate tests
Task: T005 triple-normalizer.spec.ts RED scenarios
# Agent B — US2 report builder
Task: T009 scripts/lib/kg-triple-predicate-quality.ts + spec

# After T006–T007:
# Agent A — US1 persist SC-001/002
Task: T008 form-(2) zero fixture
# Agent B — US2 CLI wire-up (if not done)
Task: T010–T011 CLI + FR-006
# Agent C — US3 metadata
Task: T012 triple-extraction-metadata skip keys
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1–2 → 2. Phase 3 US1 (T005–T008) → 3. **STOP**: SC-001/002 검증 → 4. (권장) US2 CLI 병행 완료

### Incremental Delivery

1. Setup + Foundational
2. US1 gate → demo: 형태 (2) 신규 유입 차단
3. US2 CLI → ops 관측
4. US3 soft-success → 부분 성공/관측
5. Polish → lint/type-check/graphify

### Parallel Team Strategy

- Dev A: US1 (T005–T008)
- Dev B: US2 (T009–T011) after Foundational
- Dev C: US3 (T012–T014) after T007
- All: Polish

---

## Traceability

| Requirement | Tasks |
|-------------|-------|
| FR-001 / FR-002 gate | T003, T005, T006 |
| FR-003 no form-(2) | T006, T008 |
| FR-004 kg_triple gated | T006–T008 |
| FR-005 / FR-006 CLI | T009–T011, T015 |
| FR-007 reasons | T003, T007, T012–T014 |
| FR-008 MCP unchanged | T004, T014, T019 · Global Constraints |
| FR-009 partial / soft success | T012, T013, T014 |
| FR-010 synthetic fixtures | T005, T008, T009–T011 · Global |
| SC-001 / SC-002 | T008 |
| SC-003 | T009–T011 |
| SC-004 | T017 |
| SC-005 | T014, T019 |
| SC-006 ops <1% (not CI) | T015 quickstart §5 · T019 |
| SC-007 | T013, T014 |
| OQ-1..8 / Non-Goals | T004, T019 · Global Constraints |

| User Story | Tasks |
|------------|-------|
| US1 (P1) | T005–T008 |
| US2 (P1) | T009–T011 |
| US3 (P2) | T012–T014 |

---

## Notes

- `[P]` = 다른 파일·완료된 의존만; 같은 파일 동시 편집 금지
- 기존 `triple-normalizer.spec.ts` pass-through 문서화는 **의도적 churn** (plan Dependencies)
- `convertEpisodicSource` empty 분기는 **게이트 필터 empties**만 soft-success로 분기; true `no_triple` 유지
- 커밋은 사용자 요청 시에만; 태스크 단위 커밋 메시지 예시는 plan.md Phase steps 참고
- 코드 구현은 이 문서 작성 범위 밖 (`/speckit.superspec.execute`)
