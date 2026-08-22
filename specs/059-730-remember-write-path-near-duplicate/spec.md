# Feature Specification: remember write-path near-duplicate 감지·병합 제안

**Feature Branch**: `jee1/feat-memory-remember-write-path-near-duplicate`
**Created**: 2026-08-13
**Status**: Implemented
**Issue**: [#730](https://github.com/jee1/memento/issues/730)
**Parent Epic**: [#727](https://github.com/jee1/memento/issues/727) (Memory quality ops loop)
**Related**: #728/#729/#731/#732 (형제); [012 기준선 명세](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/012-fix-memory-structuring/spec.md) US4 / FR-008 (선행 `similarity_warning`)

## Problem Statement

`remember`는 사실상 append-only다. 에이전트가 유사 content를 반복 저장하면 episodic/semantic 노이즈가
쌓이고 introspection 저신뢰·검색 `duplication_penalty` 부담이 커진다. sleep-consolidation semantic merge는
**배치**이며 write 시점 방어가 약하다.

[012 US4 기준선](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/012-fix-memory-structuring/spec.md)에서 post-insert `similarity_warning`({ count, similar_ids })가 이미 존재하지만:

- 임계값 **하드코딩 0.85** (env 없음)
- **project_id** 스코프 없음 (type + owner만)
- **merge / incremental 갱신** 경로 없음 (항상 새 row INSERT 후 경고만)
- **strict reject** 옵션 없음
- 에이전트용 “중복이면 incremental” 가이드 없음
- `remember-tool.spec.ts`에 `similarity_warning` 회귀 테스트가 현재 없음([012 T026 기준선](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/012-fix-memory-structuring/tasks.md) 흔적 소실 가능)

본 이슈는 검색측 `duplication_penalty`와 역할을 분리한 **쓰기 방어**를 완성한다.

## Goals

저장 **직전**에 동일 type/owner/project 스코프에서 유사 기억 후보를 찾아:

1. **기본**: 저장은 성공하고 `warn + candidates`를 반환 (비파괴, 기존 remember 성공 경로 유지)
2. **`update_mode=incremental`**: top near-dup 후보를 **UPDATE** (새 row 없이 병합 제안 수용)
3. **opt-in `strict`**: 임계값 이상이면 INSERT 거절 + 후보만 반환

## Non-Goals

- 전역 백필 dedup 배치 (별도 이슈)
- LLM 기반 의미 병합 (1차는 임베딩/벡터; FTS는 보조 가능하나 필수는 아님)
- 검색 랭킹 `duplication_penalty` 변경
- core/vault remember 경로 (key 기반 멱등이 이미 있음)
- procedural `update_mode` 재설계 (기존 workflow/skill 매칭 유지; near-dup 경고만 공통 적용)

## Assumptions (ratified 2026-08-15 — implement 기본값)

1. **기존 `buildSimilarityWarning`를 진화**한다. 병렬 시스템·새 MCP 도구 없음.
2. **후보 검색은 INSERT 이전**으로 옮긴다. warn 모드는 후보를 붙인 채 INSERT; strict는 INSERT 생략;
   incremental은 top 후보 UPDATE. (이슈 문구 “저장 직전” + strict/merge에 필요)
3. **기본 모드 = `warn`**. `MEMENTO_REMEMBER_DEDUP_MODE` 기본값 `warn`.
4. **임계값 기본 0.85** — 012·sleep-consolidation semantic merge와 정합. env로 조정.
5. **스코프** = 동일 `type` ∩ `owner_id`(null≡null) ∩ `project_id`(null≡null). soft-deleted 제외.
   memory_item 타입 **working 포함** (episodic/semantic/procedural warn 경로 포함). core/vault는 Non-Goals.
6. **working/episodic/semantic incremental UPDATE** (top candidate 1건): content는 요청 content로 **교체**,
   `importance = max(기존, 요청)`, tags는 합집합, semantic이면 `num_times` +1(있으면),
   `last_accessed`/`last_mentioned_at` 갱신. LLM re-summarize 없음. append 아님.
7. **응답 하위 호환**: 기존 `similarity_warning.count` / `similar_ids` 유지. `candidates`·`suggestion`·
   `action` 필드는 additive.
8. 임베딩 불가·검색 실패 시 **저장을 막지 않음** (warn/strict/incremental 모두 fail-open → 정상 INSERT).
   strict만 “후보를 찾은 경우” 거절.
9. **분기 우선순위** (후보 ≥1일 때):
   `update_mode=incremental`(working/episodic/semantic near-dup 경로) → UPDATE(merge);
   else if `MODE=strict` → reject (no INSERT);
   else → warn + INSERT.
   후보 0 또는 검색 실패 → 항상 INSERT (fail-open; `MODE=off`는 검색 스킵).
   **procedural**: `update_mode`가 있고 `findExistingProceduralMemory` hit이면 기존 procedural 병합이
   near-dup merge보다 **먼저** 적용된다 (near-dup incremental 미적용).

## User Scenarios & Testing

### User Story 1 — warn + candidates (Priority: P1) 🎯 MVP

에이전트가 이미 있는 기억과 매우 비슷한 content로 `remember`하면, 저장은 성공하고 응답에 유사 후보
목록(점수 포함)과 경고가 붙는다. 이질 content면 경고 없음.

**Why this priority**: 비파괴 기본 경로. 기존 클라이언트·에이전트 계약 유지하면서 쓰기 노이즈를 드러냄.

**Independent Test**: 동일 owner/type/project로 기억 A 저장 후 유사 content B 저장 → B 성공 +
`similarity_warning.candidates`에 A; 완전 다른 content C → warning 없음.

**Acceptance Scenarios**:

1. **Given** 임계값 이상인 기존 기억, **When** 기본(warn) remember, **Then** 새 memory_id로 저장되고
   `similarity_warning`에 count·similar_ids·candidates(similarity 포함)가 있다.
2. **Given** 임계값 미만인 이질 content, **When** remember, **Then** `similarity_warning` 필드 없음.
3. **Given** 다른 `project_id` 또는 `owner_id`의 유사 기억만 존재, **When** remember, **Then** 경고 없음.

---

### User Story 2 — env 임계값·모드 (Priority: P1)

운영자가 `MEMENTO_REMEMBER_DEDUP_THRESHOLD` / `MEMENTO_REMEMBER_DEDUP_MODE`로 민감도와 정책을 바꾼다.

**Why this priority**: 이슈 acceptance 명시 항목. 하드코딩 제거.

**Independent Test**: env로 threshold=0.99면 약유사에서 warning 사라지고, mode=strict면 거절.

**Acceptance Scenarios**:

1. **Given** `MEMENTO_REMEMBER_DEDUP_THRESHOLD=0.99`, **When** 유사도 0.90 후보만 있는 remember,
   **Then** warn 없음(또는 후보 미포함).
2. **Given** `MEMENTO_REMEMBER_DEDUP_MODE=strict` 및 임계값 이상 후보, **When** remember,
   **Then** 새 row 없음, 에러/거절 결과에 candidates 포함.
3. **Given** `MEMENTO_REMEMBER_DEDUP_MODE=off`, **When** 동일 content 반복 remember,
   **Then** 기존처럼 경고·거절 없이 INSERT만.

---

### User Story 3 — incremental 병합 수용 (Priority: P2)

에이전트가 near-dup 경고를 본 뒤 `update_mode=incremental`로 재호출(또는 첫 호출부터)하면 top 후보를
UPDATE하고 새 row를 만들지 않는다.

**Why this priority**: 노이즈 감소의 실제 치유 경로. warn만으로는 축적이 계속됨.

**Independent Test**: A 저장 → 유사 B를 `update_mode=incremental`로 remember → memory_id=A, content=B,
row count 증가 없음.

**Acceptance Scenarios**:

1. **Given** 임계값 이상 후보 A, **When** working/episodic/semantic remember with `update_mode=incremental`,
   **Then** A가 UPDATE되고 응답 `memory_id=A`, `similarity_warning.action='merged'`(또는 동등).
2. **Given** 후보 없음, **When** `update_mode=incremental`, **Then** 새 INSERT (기존 procedural 외
   동작: 후보 없으면 신규 저장).
3. **Given** procedural + 기존 workflow 매칭, **When** `update_mode=incremental`, **Then** 기존
   procedural 병합 로직 유지 (near-dup merge보다 우선; 본 이슈가 깨지 않음).

---

### User Story 4 — 에이전트 가이드 문서 (Priority: P2)

에이전트/통합 문서에 “near-dup이면 incremental로 갱신” 습관을 적는다.

**Why this priority**: 이슈 acceptance + epic #727 채택 갭.

**Independent Test**: 문서에 env·응답 필드·권장 루프가 있고 AGENTS/agent-workflow에서 링크 가능.

**Acceptance Scenarios**:

1. **Given** docs 갱신 후, **When** 에이전트가 가이드를 따르면, **Then** warn → incremental 재호출
   패턴이 명시되어 있다.

## Edge Cases

- 임베딩 서비스 비가용 / 벡터 검색 예외 → fail-open INSERT, warning 생략
- soft-deleted 후보 → 제외
- 자기 자신(재임베딩 직후 동일 id) → 후보에서 제외
- owner_id null ↔ null만 매칭 (012 clarification 유지)
- project_id null ↔ null만 매칭
- working type → 동일 규칙 적용 (단기 노이즈도 경고 가치 있음). 제외하려면 후속 이슈.
- 동시 두 remember 레이스 → 둘 다 INSERT 가능 (1차는 best-effort; 트랜잭션 직렬화 비범위)

## Requirements

### Functional Requirements

- **FR-001**: System MUST search near-duplicate candidates in scope `{type, owner_id, project_id}`
  before committing a new memory_item row (warn 모드에서도 후보 산출은 pre-insert).
  Applies to memory_item types including `working`, `episodic`, `semantic`, `procedural` (warn path);
  `core`/`vault` excluded.
- **FR-002**: System MUST read similarity threshold from `MEMENTO_REMEMBER_DEDUP_THRESHOLD`
  (default `0.85`, range (0,1]).
- **FR-003**: System MUST support `MEMENTO_REMEMBER_DEDUP_MODE` ∈ {`warn`,`strict`,`off`}
  (default `warn`).
- **FR-004**: Default `warn` MUST preserve successful remember (새 memory_id) and MAY attach
  `similarity_warning`.
- **FR-005**: `strict` MUST NOT insert when ≥1 candidate ≥ threshold and incremental merge does not
  apply (Assumptions §9); MUST return candidates.
- **FR-006**: For `working`/`episodic`/`semantic`, `update_mode=incremental` with ≥1 candidate MUST
  UPDATE the highest-similarity candidate per Assumptions §6 and MUST NOT insert a new row.
  Procedural `update_mode` hit path takes precedence per Assumptions §9.
- **FR-007**: Response `similarity_warning` MUST remain backward compatible (`count`, `similar_ids`)
  and SHOULD include `candidates: { id, similarity }[]` and optional `suggestion` /
  `action` (`warned` | `merged` | `rejected`).
- **FR-008**: Candidate search failure MUST NOT block save in `warn`/`off`; in `strict` failure
  MUST fail-open to save (거절은 후보를 확실히 찾은 경우만).
- **FR-009**: Unit tests MUST cover identical, near-similar, and dissimilar content; plus
  project/owner scope isolation; plus strict reject; plus incremental merge.
- **FR-010**: Agent-facing docs MUST describe warn→incremental habit and env knobs.
- **FR-011**: Search-side `duplication_penalty` MUST remain unchanged.

### Key Entities

- **NearDuplicateCandidate**: `{ id, similarity }` within scope, score ≥ threshold.
- **DedupPolicy**: threshold + mode from env (process config).
- **similarity_warning**: remember success/reject payload fragment.

## Success Criteria

- **SC-001**: Identical/near-dup content in same scope yields warning or merge/reject per mode ≥95%
  in unit fixtures with deterministic embeddings/mocks.
- **SC-002**: Dissimilar content and cross-project/cross-owner pairs yield 0 false warnings in fixtures.
- **SC-003**: Default mode leaves existing remember clients unbroken (필드 additive only).
- **SC-004**: `npm run lint`, `npm run type-check`, targeted remember/dedup tests pass.
- **SC-005**: Agent docs published under `docs/agents/` (또는 기존 remember 가이드 확장).

## Out of Scope (restate)

- Global backfill dedup job
- LLM re-summarize merge
- Changing recall ranking weights
