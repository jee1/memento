---
description: "Task breakdown for 660-807-fts-or-prefix (#807)"
---

# Tasks: 짧은 다개념 검색이 텍스트 후보를 잃는다

> **For agentic workers:** 이 계획은 태스크 단위로 실행한다. 각 스텝은 체크박스(`- [ ]`)로 추적한다. `[TDD]` 태스크는 RED → GREEN → REFACTOR 순서를 지킨다. 페이즈 체크포인트에서 사람 승인 없이 다음 페이즈로 넘기지 않는다 (`/speckit.superspec.execute`).

**Goal**: 짧은 FTS 쿼리의 암시적 AND를 **OR + prefix\***로 바꿔 다개념·한국어 조사 표면형에서도 텍스트 후보가 0이 되지 않게 하고, ablation으로 채택/미채택을 기록한다 (#807).

**Architecture**: 공유 `buildFTSQuery` (`search-engine-fts-query.ts`) 한 곳에서 내용어에 `OR` 결합 + `FTS_MIN_PREFIX_STEM_LENGTH`(2) 이상만 `*`를 붙인다. 긴 구간은 기존 first-8 OR 캡을 유지하며 접두만 추가한다. MCP 스키마·`ranking-weights.toml`·trigram 기본값·kill-switch env는 건드리지 않는다.

**Tech Stack**: TypeScript 5.x, Node.js ≥24, ES modules, SQLite FTS5, Vitest. 신규 dependency 없음.

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) | **Data model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/fts-query-combinator.md](./contracts/fts-query-combinator.md), [contracts/mcp-search-schema-unchanged.md](./contracts/mcp-search-schema-unchanged.md) | **Quickstart**: [quickstart.md](./quickstart.md) | **Ablation**: [fts-query-ablation.md](./fts-query-ablation.md)

**Input**: Design documents from `/specs/660-807-fts-or-prefix/`
**Tests**: 필수. 헌법 I(Test-First) — `buildFTSQuery` 기대값·합성 픽스처 `text_candidate_count > 0`·조사 픽스처는 자동 테스트 없이 완료로 치지 않는다.

## Format: `[ID] [markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 다른 `[P]` 태스크와 병렬 가능 (파일이 겹치지 않음) |
| `[TDD]` | RED → GREEN 강제 |
| `[REVIEW]` | 사람 리뷰 후 진행 |
| `[SUBAGENT]` | 서브에이전트 위임 가능 |

## Global Constraints

이 절의 항목은 **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- Node.js ≥24, TypeScript ES modules, npm workspaces (`packages/memento-core`).
- 변경 단일 진입점: `packages/memento-core/src/domains/search/algorithms/search-engine/search-engine-fts-query.ts` (+ `HYBRID_SEARCH` 상수). 경로별 다른 결합자 금지 (FR-020).
- `FTS_OR_ABOVE_TOKEN_COUNT = 5`, `FTS_MAX_TOKENS_FOR_OR = 8` **숫자 유지** (경계 재설계 Out of Scope).
- `FTS_MIN_PREFIX_STEM_LENGTH = 2` — 미만은 접두 없음 (FR-014/Q1).
- 사용자 연산자 주입 금지 — `preprocessQuery`가 내용어만 남김 (FR-015).
- 공개 MCP/검색 스키마 불변 (FR-018/SC-008). `config/ranking-weights.toml` 미변경 (FR-009).
- 기존 LIMIT·후보 상한만 사용 — 무제한 풀 금지 (FR-017).
- LoCoMo/프로덕션 DB 덤프 커밋 금지 — 합성 픽스처·집계만 (FR-013).
- #806 절대 벡터 점수 없이는 **벡터 정밀도 채택 판정** 열을 채우지 않음. 텍스트 후보·합성 게이트는 병렬 가능 (Q8).
- 정밀도 미흡수 시 기본값 미변경 + 사유 기록 (FR-006/Q3). kill-switch env 추가 금지 (Q14).
- Complete before finish: `npm run lint`, `npm run type-check`, targeted search vitest, graphify rebuild. Do **not** commit `graphify-out/`.
- Branch: `660-807-fts-or-prefix`. Do not push/PR without user approval.
- Issue refs in commits: `Refs #807`.

---

## Phase 1: Setup

**Purpose**: 변경 전 기준선. 기존 실패를 이번 변경 탓으로 오해하지 않는다.

- [x] **T001** 기준선 확인

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts
  ```

  Expected: PASS (현재 “짧은 쿼리 AND 유지” 케이스 포함). 실패 시 **여기서 멈추고 보고**.

**Checkpoint**: 기준선 green → Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 상수 + `buildFTSQuery` OR+prefix. **US1–US5 전부 여기 의존.**

**⚠️ CRITICAL**: T003 완료 전 User Story 픽스처/문서 채택 작업 시작 금지 (문자열 계약이 먼저 고정되어야 함).

### T002 [TDD] `FTS_MIN_PREFIX_STEM_LENGTH` 상수

**Files:**
- Modify: `packages/memento-core/src/shared/config/constants.ts` (`HYBRID_SEARCH` 블록, `FTS_MAX_TOKENS_FOR_OR` 근처)

**Interfaces:**
- Produces: `HYBRID_SEARCH.FTS_MIN_PREFIX_STEM_LENGTH: 2` (`as const`)

- [x] **Step 1: 실패 테스트** — 아래 T003 스펙에서 `HYBRID_SEARCH.FTS_MIN_PREFIX_STEM_LENGTH`를 import/참조하는 assertion을 먼저 추가하면 RED (property missing)로도 충분. 또는 상수 export 단위 assert:

  ```ts
  import { HYBRID_SEARCH } from '../../../../shared/config/constants.js';
  expect(HYBRID_SEARCH.FTS_MIN_PREFIX_STEM_LENGTH).toBe(2);
  ```

- [x] **Step 2: RED** — 상수 없으면 FAIL

- [x] **Step 3: 최소 구현** — `FTS_MIN_PREFIX_STEM_LENGTH: 2` 추가, JSDoc 한 줄 (접두 최소 어간)

- [x] **Step 4: GREEN**

- [x] **Step 5: Commit** — `feat(search): add FTS_MIN_PREFIX_STEM_LENGTH=2\n\nRefs #807`

---

### T003 [TDD] `buildFTSQuery` — short OR+prefix, long OR+prefix+cap

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/search-engine/search-engine-fts-query.ts`
- Modify: `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts` (`describe('buildFTSQuery')`)

**Interfaces:**
- Consumes: `HYBRID_SEARCH.FTS_OR_ABOVE_TOKEN_COUNT`, `FTS_MAX_TOKENS_FOR_OR`, `FTS_MIN_PREFIX_STEM_LENGTH`
- Produces: MATCH string per [contracts/fts-query-combinator.md](./contracts/fts-query-combinator.md)
  - empty/stopword-only → `""`
  - stem `length >= 2` → `stem*`
  - stem `length < 2` → exact
  - ≥2 terms → ` OR ` joined; long → first 8 only
- `makeFTSSafe` must preserve `*` and ` OR `

- [x] **Step 1: 실패 테스트** — 기존 AND 케이스를 교체·보강:

  ```ts
  it('짧은 다개념 쿼리는 OR + prefix* 로 결합한다', () => {
    const result = (searchEngine as any).buildFTSQuery('검색 랭킹 가중치 튜닝');
    expect(result).toContain(' OR ');
    expect(result).toMatch(/검색\*/);
    expect(result).toMatch(/랭킹\*/);
    expect(result).toMatch(/가중치\*/);
    expect(result).toMatch(/튜닝\*/);
  });

  it('1글자 어간에는 접두를 붙이지 않는다', () => {
    const result = (searchEngine as any).buildFTSQuery('a test');
    // 'a' exact; 'test' → test* (stopwords 정책에 맞게 조정)
    expect(result).not.toMatch(/(^| )a\*/);
  });

  it('긴 쿼리는 최대 토큰 수까지 OR + prefix', () => {
    const result = (searchEngine as any).buildFTSQuery(
      'Memento recall 검색 데이터 조회 하이브리드 검색 엔진 테스트 추가'
    );
    expect(result).toContain(' OR ');
    const terms = result.split(' OR ');
    expect(terms.length).toBeLessThanOrEqual(HYBRID_SEARCH.FTS_MAX_TOKENS_FOR_OR);
  });

  it('연산자처럼 보이는 기호는 MATCH 연산자로 남지 않는다', () => {
    const result = (searchEngine as any).buildFTSQuery('foo AND bar "baz"');
    expect(result).not.toMatch(/\bAND\b/);
    expect(result).not.toContain('"');
  });
  ```

  기존 “짧은 쿼리 … AND 유지” / `not.toContain(' OR ')` 는 **삭제 또는 기대값 반전**.

- [x] **Step 2: RED** — `npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts` → FAIL

- [x] **Step 3: 최소 구현** — `buildFTSQuery`에서 토큰별 prefix 적용 후 short/long 모두 `OR` join; empty 경로·`makeFTSSafe` 순서 유지 (research R4)

- [x] **Step 4: GREEN** — 동일 스펙 PASS

- [x] **Step 5: Commit** — `fix(search): short FTS combinator AND to OR with prefix*\n\nRefs #807`

**Checkpoint**: 문자열 계약 green → User Stories.

---

## Phase 3: User Story 1 — 짧은 다개념 질문이 텍스트 후보를 얻는다 (P1) 🎯 MVP

**Goal**: 개념이 문서에 흩어진 픽스처에서 짧은 다개념 쿼리의 텍스트 후보 > 0 (FR-001/FR-007/SC-001).

**Independent Test**: 합성 코퍼스 + 짧은 4단어 쿼리 → text candidates > 0, 부분 매치 기억 포함.

### T004 [TDD] [US1] 합성 다개념 픽스처 — text 후보 > 0

**Files:**
- Create: `packages/memento-core/src/domains/search/algorithms/__tests__/fts-or-prefix-candidates.spec.ts`
- (필요 시) 기존 in-memory DB/FTS 헬퍼 재사용: `packages/memento-core/src/test/helpers/` 또는 SearchEngine 테스트 셋업 패턴

**Interfaces:**
- Consumes: `buildFTSQuery` / SearchEngine text search path (실제 FTS MATCH)
- Produces: 회귀 테스트가 SC-001을 고정

- [x] **Step 1: 실패 테스트**

  - 기억 A–D: 각각 `검색` / `랭킹` / `가중치` / `튜닝` 중 하나만 본문에 포함 (네 단어 모두 담긴 기억 없음)
  - 쿼리: `검색 랭킹 가중치 튜닝`
  - Assert: text candidate count > 0; A–D 중 최소 일부가 후보에 포함
  - (가능하면) 긴 쿼리 회귀: 기존 OR 구간에서도 후보 > 0
  - 단일 토큰 쿼리: 해당 단어 기억이 후보에 남음

- [x] **Step 2: RED** — T003 전이면 당연히 실패; T003 후에도 픽스처/검색 경로 미연결이면 FAIL

- [x] **Step 3: 최소 구현** — T003이 이미 충분하면 픽스처·테스트 하네스만; LIKE fallback 경로를 새로 바꾸지 않음 (R8)

- [x] **Step 4: GREEN**

- [x] **Step 5: Commit** — `test(search): multi-concept short query text candidates > 0\n\nRefs #807`

**Checkpoint**: US1 independent test PASS → MVP 문자열+후보 확보.

---

## Phase 4: User Story 2 — 조사·활용 표면형 (P1)

**Goal**: 본문 `가중치는` vs 질의 `가중치`가 텍스트 후보에 포함 (FR-002/SC-003).

**Independent Test**: 조사 융합 픽스처에서 대상 기억이 text candidates에 포함.

### T005 [TDD] [US2] 조사 융합 픽스처

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/__tests__/fts-or-prefix-candidates.spec.ts` (또는 동일 디렉터리 sibling spec)

- [x] **Step 1: 실패 테스트**

  - 기억 본문: `... 가중치는 ...` (어간만 단독 토큰으로 없는 형태)
  - 쿼리: `가중치`
  - Assert: 해당 기억이 FTS text 후보에 포함; `buildFTSQuery('가중치')` contains `가중치*`

- [x] **Step 2: RED** (prefix 없으면 FAIL)

- [x] **Step 3: GREEN** — T003 prefix로 통과해야 함; 추가 코드는 YAGNI

- [x] **Step 4: Commit** — `test(search): Korean particle morphology via FTS prefix\n\nRefs #807`

**Checkpoint**: US1+US2 green.

---

## Phase 5: User Story 3 — 상위 관련성 / 채택 게이트 (P1)

**Goal**: 후보 증가 후에도 상위 관련성 비악화 여부를 기록하고, 미흡수 시 미채택 (FR-004–006/SC-002/FR-022).

**Independent Test**: ablation 표에 SC-002·채택/미채택 사유가 남아 있음.

### T006 [US3] [SUBAGENT] ablation 표에 정밀도·채택 열 채우기

**Files:**
- Modify: `specs/660-807-fts-or-prefix/fts-query-ablation.md`

- [x] **Step 1**: Variant A(baseline)/B(OR only)/C(OR+prefix)에 대해 T004 픽스처 기준 text zero-hit / candidate notes 기록
- [x] **Step 2**: SC-002용 “관련 기억 top-10 포함 여부”를 합성 픽스처로 기록 (가능하면 자동화 assert를 T004에 보조 케이스로 추가)
- [x] **Step 3**: 벡터 정밀도 열 — **#806 미완료면 `deferred until #806`** 명시; 완료 시에만 채움 (Q8)
- [x] **Step 4**: Decision — C 채택 또는 reject+사유 (FR-006). reject 시 T003 변경을 revert하거나 feature 브랜치에서 기본값 유지 결정를 표에 명시
- [x] **Step 5**: Commit — `docs(search): record #807 ablation adopt/reject\n\nRefs #807`

### T007 [REVIEW] [US3] 채택 판정 리뷰 게이트

- [x] 사람 리뷰: SC-002 / fail-closed / #806 의존이 ablation 표와 일치하는지 확인 후 Phase 6+ *(cavecrew-reviewer: no blockers; adopt C + #806 deferred)*

**Checkpoint**: US3 기록 완료 (채택 또는 명시적 미채택).

---

## Phase 6: User Story 4 — 영어 회귀 (P1)

**Goal**: 기존 nightly/벤치 게이트 한도 내 (FR-008/SC-004/Q7). 원본 코퍼스 커밋 금지.

### T008 [P] [US4] [SUBAGENT] 영어 게이트 실행·기록

**Files:**
- Modify: `specs/660-807-fts-or-prefix/fts-query-ablation.md` (English gate 열)
- (실행만) 기존 벤치/nightly 명령 — **새 ad-hoc 임계 금지**

- [x] **Step 1**: 프로젝트에서 승인된 영어 세션 검색 평가 명령 실행 (없으면 합성 영어 픽스처로 대체하고 표에 “synthetic substitute” 표기)
- [x] **Step 2**: pass/fail + 지표 요약을 ablation 표에 기록 (원본 데이터 커밋 금지)
- [x] **Step 3**: Commit — `docs(search): record English gate for #807\n\nRefs #807`

**Checkpoint**: English gate 열 non-empty.

---

## Phase 7: User Story 5 — ablation 완성 · 차선 대안 (P2)

**Goal**: 표 완성, trigram=compare-only, ranking-weights diff 0 (FR-010/FR-009/SC-005/SC-006).

### T009 [P] [US5] trigram·가중치 Non-Goal 명시

**Files:**
- Modify: `specs/660-807-fts-or-prefix/fts-query-ablation.md` (Variant D 행)
- Verify: `git diff -- config/ranking-weights.toml` → empty for this work

- [x] Variant D: tokenize=trigram → **compare-only / not default** + 사유 한 줄
- [x] Confirm no `ranking-weights.toml` changes in branch
- [x] Commit if needed — deferred (user commit policy)

### T010 [P] [US5] 이슈 요약 링크

**Files:**
- (optional) `gh issue comment 807` — ablation 경로·채택 결정 한 단락 (사용자 승인 후)

- [x] Skipped — no gh side effect without ask (Ruling in progress.yml)

**Checkpoint**: FR-021/SC-006 충족.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: 문서·품질 게이트·스키마 불변 확인.

### T011 [P] [SUBAGENT] `docs/agents/search-ranking.md` combinator 문단 갱신

**Files:**
- Modify: `docs/agents/search-ranking.md` (FTS5 BM25 절의 combinator 문장 — “짧은 AND …” → short OR + prefix*, `#807` 링크)

- [x] Commit — deferred (user commit policy); docs updated in-tree

### T012 [P] quickstart 검증

- [x] Run [quickstart.md](./quickstart.md) 섹션 1–3 명령; 기대값 충족.

### T013 완료 게이트

```bash
npm run lint && npm run type-check
npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts
npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/fts-or-prefix-candidates.spec.ts
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

- [x] graphify-out은 커밋하지 않음
- [x] MCP/스키마 스냅샷 있다면 SC-008 확인 ([contracts/mcp-search-schema-unchanged.md](./contracts/mcp-search-schema-unchanged.md)) — 스키마 파일 변경 없음

### T014 [REVIEW] 최종 리뷰

- [x] Diff에 `ranking-weights.toml` / MCP schema / 새 env kill-switch / LoCoMo 원본 없는지 확인
- [x] ablation Decision과 코드 기본값 일치 (Adopt C)
- [x] Spec status → Implemented (pending commit/PR)

**Checkpoint**: Feature ready for PR (사용자 요청 시).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 없음
- **Phase 2 Foundational**: Setup 후 — **모든 US 차단**
- **Phase 3 US1**: Foundational 후 — MVP
- **Phase 4 US2**: Foundational 후; US1 픽스처 파일과 공유 시 T004 이후 권장
- **Phase 5 US3**: US1(+US2) 측정 가능 후; #806은 벡터 열만 차단
- **Phase 6 US4**: Foundational 후; T008은 T006과 `[P]` 가능(파일 충돌 주의 — ablation 표 순차 편집 권장)
- **Phase 7 US5**: ablation 표 기반
- **Phase 8 Polish**: 원하는 US 완료 후

### User Story Dependencies

| Story | Depends on |
|-------|------------|
| US1 | T002–T003 |
| US2 | T003 (prefix); T004 파일 재사용 시 T004 후 |
| US3 | US1 측정; #806 for vector precision column only |
| US4 | T003 기본값이 켜진 브랜치 |
| US5 | T006 골격 |

### Parallel Opportunities

```text
After T003:
  T004 [US1]  ──┐
  T011 docs   [P][SUBAGENT]  (docs only; can early)
After T004:
  T005 [US2]
After measurements exist:
  T006 [US3] then T008 [US4] (prefer sequential on same md)
  T009 [P][US5]
```

### Within each [TDD] task

Tests MUST fail before implementation. Commit after GREEN (user commit policy: ask before commit if unsure).

---

## Implementation Strategy

### MVP First (US1)

1. T001 → T002 → T003 → T004  
2. **STOP**: 짧은 다개념 text 후보 > 0 데모 가능  
3. 이어서 T005 → T006/T007 → T008 → T009 → T011–T014

### Fail-closed

Ablation이 SC-002/영어 게이트 실패를 보이면 **T003을 전역 기본으로 남기지 않음** — Decision=reject 기록 후 AND 동작 복구 또는 브랜치 미머지.

### Spec coverage checklist

| FR / SC | Tasks |
|---------|-------|
| FR-001, FR-007, SC-001 | T003, T004 |
| FR-002, FR-014, SC-003 | T002, T003, T005 |
| FR-003, long OR+prefix | T003 |
| FR-004–006, SC-002, FR-022 | T006, T007 |
| FR-008, SC-004 | T008 |
| FR-009, SC-005 | T009, T014 |
| FR-010, US5 trigram | T009 |
| FR-011, FR-017 | T003, T004 (no new caps) |
| FR-012, #808 | T006 note / later measure — not blocking |
| FR-013 | T004–T008 (synthetic only) |
| FR-015 | T003 operator test |
| FR-016 | T003 long+short prefix |
| FR-018, SC-008 | T013, T014 |
| FR-019 | T004 funnel/count |
| FR-020 | single-file T003 |
| FR-021, SC-006 | T006, T010 |
| SC-007 | deferred to #808 gold — note in ablation if absent |

---

## Notes

- `[P]` = 다른 파일·무의존. 같은 `fts-query-ablation.md`를 동시에 쓰지 말 것.
- Commit messages: `Refs #807`.
- 다음: `/speckit.superspec.execute` 또는 인라인 실행.
