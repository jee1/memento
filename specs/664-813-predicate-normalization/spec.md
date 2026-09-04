# Feature Specification: triple predicate 정규화 — 재조립 폴백률 급증 차단

**Feature Branch**: `fix-semantic-triple-2026-08-11.6-predicate`
**Spec Directory**: `specs/664-813-predicate-normalization`
**Created**: 2026-09-04
**Status**: Ready for Planning
**Issue**: [#813](https://github.com/jee1/memento/issues/813)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: #804 (격리·FR-001b 형태(2) 제외), #805 (재오염 차단), #768 (재조립·원문 폴백), #811 (repair)
**Input**: fix(semantic): triple 재조립 폴백률 2026-08 11.6% 급증 — predicate 비한글 종결

## Problem Statement

`buildTripleSentence` 재조립 실패율이 2026-08 들어 급증했다. 실패하면
`tripleToNaturalLanguage`가 원본 episodic 본문을 그대로 content로 저장한다
(형태 (2) 폴백, #768 경로).

| 월 | 생성 | 폴백 | 폴백률 |
|---|---:|---:|---:|
| 2026-04 | 8,715 | 0 | 0.0% |
| 2026-05 | 12,250 | 0 | 0.0% |
| 2026-06 | 997 | 0 | 0.0% |
| 2026-07 | 1,122 | 1 | 0.1% |
| 2026-08 | 1,022 | **119** | **11.6%** |

2026-08-23 라이브 읽기 전용 실측. 2시간 간격으로 두 번 집계했더니 `subject` 보유
semantic이 24,233 → 24,251 (+18)이고 **증가분 18건이 전량 형태 (2)** 였다. 진행형이다.

### 직접 원인

`conjugatePredicate`(`triple-sentence.ts`)는 predicate의 마지막 글자가 한글이 아니면
즉시 `null`을 반환한다.

- 형태 (2) **116/116건 전부** predicate 마지막 글자가 한글이 아니다
- 같은 8월분 형태 (1) 876건 중 782건(89%)은 한글 종결 → **코드가 아니라 predicate
  데이터의 성격이 변했다**
- 형태 (2) predicate: 평균 8.2자, 최대 25자, 32건이 공백 포함 → 단일 동사가 아닌
  **정규화되지 않은 구(phrase)**
- 비교: `kg_triple` 전체 predicate 평균은 4.1자

상류에서 `PredicateCanonicalizer.canonicalize`가 사전 미매칭 시 `success: false`로
원본을 반환하고, `TripleNormalizer`는 그 원본을 **그대로 통과**시킨다
(`success ? canonical : triple.predicate`). 렌더러는 그 구를 활용할 수 없다.

### 파급

`kg_triple`도 같은 오염을 받는다. 2026-08-23 실측 24,204건 중 한글 종결 23,218(96%),
공백 포함 5,793(24%). 격리(#804)가 보장하는 것은 s/p/o **조합의 존재**이지
그 **품질**이 아니다.

#804 FR-001b는 형태 (2)를 격리 대상에서 제외하는데, 근거가 "비중이 작다(0.48%)"이다.
이 추세가 이어지면 근거가 무너진다.

## Goals

- 추출 파이프라인에서 **canonical하지 않은 predicate**(구·영문 종결 등)가
  semantic content / `kg_triple`로 유입되는 것을 차단하거나 정규화한다.
- 신규 형태 (2) 폴백률을 **게이트 경로 테스트에서 0%**, 라이브 신규 생성에 대해
  **운영 목표 < 1%**로 낮춘다(후자는 측정 가능 ops 목표; 라이브 DB 대상 flaky CI 아님).
- `kg_triple` predicate 품질 지표를 CLI read-only 리포트로 상시 관측 가능하게 한다.
- MCP 도구 계약·검색 응답 형태는 변경하지 않는다.

## Non-Goals

- 이미 저장된 형태 (2) semantic / 오염 `kg_triple`의 **대량 백필·일괄 rewrite**
  (필요 시 후속 이슈; #804·#811 인접) — OQ-4 확정
- LLM 프롬프트 전면 재설계 또는 새 추출 모델 도입
- `conjugatePredicate`에 영문·임의 구 활용 규칙 추가(품질 보증 불가)
- #804 격리 러너 재실행·형태 (2) 격리 범위(FR-001b) 변경
- Predicate 사전(`DEFAULT_PREDICATE_DICTIONARY`)의 대규모 확장·동의어 수확 자동화
  (기존 `addPredicate`는 후속 운영 수단으로만 유지; 본 이슈 게이트가 사전 확장을 요구하지 않음)
- Admin telemetry HTTP endpoint (선택 후속; v1은 CLI만)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 정규화 실패 predicate는 semantic으로 저장되지 않는다 (Priority: P1)

시스템이 episodic에서 triple을 추출할 때, 게이트를 통과하지 못한 predicate를
가진 triple은 semantic memory로 persist되지 않는다. 사전 매칭에 성공하면
canonical 형태만 persist하고, 사전 미매칭이어도 **한글 종결 단일 토큰**이고
`buildTripleSentence`가 성공하면 그 토큰을 수용한다. 그 외(구·영문 종결·재조립
불가)는 drop한다.

**Why this priority**: 형태 (2) 유입이 진행 중이며 #804 FR-001b 근거를 잠식한다.

**Independent Test**: 구/영문 종결 predicate fixture로 추출→persist 경로를 돌리면
형태 (2) content가 생기지 않고 structured skip/drop이 기록된다. 한글 OOV 단일
토큰 fixture는 재조립 성공 시 persist된다.

**Acceptance Scenarios**:

1. **Given** predicate가 `관련 작업`(공백 포함·비한글 종결)인 추출 triple,
   **When** normalizer/persist 경로가 실행되면,
   **Then** 해당 triple은 semantic으로 저장되지 않고 reason
   `predicate_canonicalize_failed` 또는 `predicate_reassembly_failed`로 skip된다.
2. **Given** predicate가 `use`(영문)인 추출 triple,
   **When** 동일 경로 실행,
   **Then** 사전에 `사용함` 매핑이 있으면 canonical로 저장되고, 매핑이 없으면
   drop되며 형태 (2) 원문 폴백 content가 생성되지 않는다.
3. **Given** predicate가 `사용함`(canonical),
   **When** 동일 경로 실행,
   **Then** `buildTripleSentence` 성공 문장이 content로 저장된다.
4. **Given** predicate가 사전 미등재 한글 종결 단일 토큰(예: `배포함`)이고
   `buildTripleSentence`가 성공,
   **When** 동일 경로 실행,
   **Then** 해당 triple은 그 predicate로 persist되며 형태 (2) 폴백이 아니다.
5. **Given** predicate가 한글 종결이지만 `buildTripleSentence`가 `null`,
   **When** 동일 경로 실행,
   **Then** triple은 drop되고 reason `predicate_reassembly_failed`가 기록된다.

---

### User Story 2 - 운영자가 predicate 품질을 CLI로 관측한다 (Priority: P1)

운영자는 npm script CLI로 `kg_triple`(및 필요 시 semantic) predicate에 대해
한글 종결 비율·공백 포함 비율·평균 길이·재조립 불가 건수를 **read-only 리포트**로
확인한다. 집계 스타일은 기존 `memory:repair-triple-sentences` /
`memory:quarantine-065` 계열 CLI와 맞춘다.

**Why this priority**: 이슈가 "상시 관측 대상 승격"을 명시; 추세 재발을 조기에 본다.

**Independent Test**: 시드 DB에 양호/불량 predicate를 넣고 CLI가 집계·샘플만
출력(절대 경로·전수 ID 덤프 금지). DB 행 수 불변.

**Acceptance Scenarios**:

1. **Given** 한글 종결 9건·비한글 종결 1건의 `kg_triple`,
   **When** quality report CLI 실행,
   **Then** hangul_termination_rate ≈ 0.9 및 non_hangul 샘플(최대 N)이 포함된다.
2. **Given** report만 실행,
   **When** 완료,
   **Then** DB 행 수는 변하지 않는다.

---

### User Story 3 - 정규화 실패가 관측 가능하며 부분 성공한다 (Priority: P2)

추출 중 canonicalize/재조립 실패·triple drop이 structured log / 카운터로 남고,
한 episodic에서 일부 triple만 실패해도 성공분만 저장한다(부분 성공). 주
경로(remember/recall)는 중단되지 않는다.

**Why this priority**: Principle V — 실패 격리와 관측; #805 metadata 패턴과 정렬.

**Independent Test**: 실패 fixture 추출 후 로그/메트릭에 reason 코드가 남고
성공 triple만 persist되며 MCP recall은 정상 응답한다.

**Acceptance Scenarios**:

1. **Given** canonicalize 실패 triple,
   **When** 추출 배치/remember 증강이 실행되면,
   **Then** `predicate_canonicalize_failed` | `predicate_reassembly_failed` |
   `predicate_empty` reason이 기록되고 주 경로는 성공한다.
2. **Given** 한 episodic에서 일부 triple만 실패,
   **When** persist,
   **Then** 성공 triple만 저장되고 실패분은 skip되며, episodic
   `triple_extracted` 성공 판정은 **성공 triple이 1건 이상**이면 primary
   success로 유지한다(전부 필터되어도 주 remember 경로는 실패로 뒤집지 않음;
   skip 카운트·reason은 metadata에 남김 — #805 정렬).

### Edge Cases

| Category | Case | Decision |
|----------|------|----------|
| Boundary | 빈 predicate / 공백만 | drop; reason `predicate_empty` |
| Boundary | 한글 종결·사전 미등재 단일 토큰 (예: `배포함`) | **허용 iff** `buildTripleSentence` 성공; 사전 매칭 가능하면 canonical 우선 |
| Boundary | 공백 포함 한글 구 (예: `관련 작업`) | drop — v1 헤드워드 휴리스틱 없음 (OQ-1) |
| Boundary | 비한글 종결 / 영문 단독 (사전 미매칭) | drop; 사전 동의어(`use`→`사용함`)면 canonical 수용 |
| Boundary | 이미 저장된 형태 (2) / 오염 kg_triple | Non-Goal; 신규 유입만 차단 |
| Boundary | 필터 후 persist 대상 0건 | primary 경로 성공 유지 + skip metadata; 빈 semantic 배치로 실패 전파 금지 |
| Error | `buildTripleSentence` null (재조립 불가) | drop; reason `predicate_reassembly_failed`; **원문 폴백 금지** |
| Error | canonicalize `success: false` + 재조립도 실패 | drop; 통과(pass-through) 금지 — `TripleNormalizer` 게이트 변경 |
| Scale | quality report | 집계 + 샘플 상한 N; 전수 ID·절대 경로 덤프 금지 |
| Scale | 사전 성장 | 본 이슈 Non-Goal; 게이트가 사전 확장을 전제하지 않음 |
| Security | CLI / 로그 출력 | FR-006; 프로덕션 절대 경로·시크릿 비노출 |
| Security / Licensing | 테스트 fixture | **합성만**; 라이브 DB 스냅샷·실사용자 본문 커밋 금지 (Constitution Additional Constraints) |
| UX / Ops | #804 FR-001b | 형태 (2) 격리 제외 **유지**; 본 게이트로 신규 형태 (2) 유입을 막아 제외 근거(비중)를 보호 |
| UX / Ops | 동시 추출 경쟁 | #805 CAS와 충돌 없음(persist 전 필터); relation post-commit 실패는 primary 성공을 뒤집지 않음 |
| UX / Ops | kg_triple upsert | FR-001 게이트 통과 predicate만 기록; 스키마 마이그레이션 없음 |
| UX / Ops | 운영 폴백률 | 라이브 신규 생성 < 1%는 **ops 측정 목표**(CLI/수동); CI는 합성 fixture 0%만 강제 |

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템 MUST semantic / `kg_triple` persist 전에 predicate 게이트를
  적용한다. 수용 조건(우선순위 순):
  1. `PredicateCanonicalizer.canonicalize` `success: true` → canonical 사용
     (이후에도 `buildTripleSentence` 가능해야 함; 불가 시 drop),
  2. 아니면 **공백 없는 한글 종결 단일 토큰**이고 `buildTripleSentence` 성공 →
     원본(trim) 수용,
  3. 그 외 MUST drop (휴리스틱 헤드워드 추출 없음).
- **FR-002**: `TripleNormalizer`(또는 동등 단일 게이트) MUST canonicalize
  `success: false`인 경우 원본 predicate를 **무조건 통과시키지 않는다**.
  FR-001 규칙 2를 만족할 때만 예외적으로 원본(단일 한글 토큰)을 수용한다.
- **FR-003**: 시스템 MUST 신규 semantic triple content가 형태 (2) 원문 폴백이 되지
  않도록 한다(폴백 대신 drop 또는 canonical/`buildTripleSentence` 재조립 문장).
  AGENTS #768: `합니다` 문자열 덧붙이기 금지; `buildTripleSentence()`만 사용.
- **FR-004**: 시스템 MUST `kg_triple`에 기록되는 predicate가 FR-001 게이트를
  통과한 값만 사용한다(동일 오염 유입 차단). 스키마 변경 없음.
- **FR-005**: 운영 도구 MUST `kg_triple` predicate 품질 지표를 **CLI npm script**
  (read-only)로 제공한다: 한글 종결 비율, 공백 포함 비율, 평균 길이, 재조립
  불가(비한글 종결) 건수·제한 샘플. 집계 스타일은 기존 repair/quarantine CLI와
  맞춘다. Admin telemetry endpoint는 본 이슈 범위 밖(후속 선택).
- **FR-006**: FR-005 MUST 프로덕션 DB 절대 경로·전수 ID를 공개 출력에 무제한
  덤프하지 않는다(집계·제한 샘플).
- **FR-007**: canonicalize/재조립 실패 MUST 주 recall·remember 응답 경로를
  중단하지 않고 structured log(또는 동등 카운터/메타데이터)에 reason을 남긴다.
  Reason 코드(고정 집합): `predicate_empty` |
  `predicate_canonicalize_failed` | `predicate_reassembly_failed`.
- **FR-008**: MCP 도구 계약·검색 응답 스키마 MUST 변경하지 않는다.
- **FR-009**: 한 episodic 추출에서 일부 predicate만 게이트 실패 시 시스템 MUST
  **부분 성공**한다 — 성공 triple만 persist하고 실패분은 skip+reason;
  단일 불량 predicate만으로 전체 추출을 하드 실패시키지 않는다.
  `triple_extraction_metadata`(또는 동등)에 skip 건수·reason 집계를 남겨
  #805 패턴과 정렬한다. 전부 skip이어도 primary remember/증강 성공을
  실패로 뒤집지 않는다(관측은 FR-007).
- **FR-010**: 게이트·리포트·단위/통합 테스트에 쓰는 fixture MUST 합성이며,
  라이브 DB에서 복사한 실사용자 본문·실측 ID 목록을 커밋하지 않는다.

### Key Entities

- **Canonical predicate**: 사전 표준형(`사용함`, `정의됨` 등 ㅁ 명사화형).
- **Accepted OOV predicate**: 사전 미등재·한글 종결·단일 토큰·재조립 가능.
- **Phrase predicate**: 공백·장문·비한글 종결 등 재조립 불가 원본 → drop 대상.
- **형태 (2) semantic**: `tripleToNaturalLanguage`가 원문 episodic을 content로 저장한 행.
- **`kg_triple`**: s/p/o 조합 보존 테이블; 품질 ≠ 존재.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 합성 fixture 기준, 게이트 경로에서 canonicalize 실패·비한글 종결·
  재조립 불가 predicate로 형태 (2) semantic이 **0건** 생성된다
  (신규 form-(2) rate from gated path = **0% in tests**).
- **SC-002**: 동일 fixture로 `kg_triple`에 비한글 종결 / 게이트 미통과
  predicate가 **0건** 삽입된다.
- **SC-003**: quality report CLI가 한글 종결 비율·공백 비율·평균 길이·재조립
  불가 건수·제한 샘플을 반환하고 DB를 변경하지 않는다.
- **SC-004**: `npm run lint`, `npm run type-check`, 관련 도메인 테스트 통과.
- **SC-005**: MCP recall/remember 계약 회귀 없음.
- **SC-006**: 운영 목표 — 게이트 배포 후 **라이브 신규 생성** 형태 (2) 비율
  **< 1%**(CLI/수동 집계로 측정). CI는 라이브 DB에 대해 이 비율을 assert하지
  않는다(flaky 방지). SC-001이 CI 강제치.
- **SC-007**: 부분 성공 fixture에서 성공 triple persist + skip reason 기록이
  검증되고, 전부 skip이어도 주 경로가 하드 실패로 전파되지 않는다.

## Assumptions

- 근본 원인은 렌더러가 아니라 **상류 정규화 게이트 부재**이다
  (`TripleNormalizer` pass-through 확인됨).
- `conjugatePredicate`에 임의 구 활용을 추가하는 것은 Non-Goal이다.
- 기존 오염 데이터 정리는 후속; 본 스펙은 **유입 차단 + 관측**에 집중한다.
- #805 재추출/CAS와 병행 가능하며, 차단이 선행되어야 재추출이 의미 있다(이슈 본문).
- Dictionary match가 가능하면 항상 preferred; OOV 허용은 재조립 가능한 한글
  단일 토큰에 한정한다.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| OQ-1 | canonicalize 실패 시 drop vs 휴리스틱 정규화(헤드워드·조사 제거)? | **Resolved** | **Drop**. 재조립 불가·구·비한글은 drop. v1 헤드워드 휴리스틱 없음(취약). Session 1. |
| OQ-2 | 사전에 없는 **한글 종결** 단일 토큰은 통과(재조립 가능) vs 사전 필수? | **Resolved** | **허용 iff** `buildTripleSentence` 성공. 재조립 실패 시 reject. 사전 매칭 가능 시 canonical 우선. Session 1. |
| OQ-3 | 품질 리포트 전달 경로: CLI npm script vs admin telemetry endpoint? | **Resolved** | **CLI npm script** (read-only). repair/quarantine CLI 집계 스타일 미러. Admin telemetry는 선택 후속. Session 1. |
| OQ-4 | 기존 형태 (2)·오염 kg_triple 백필을 본 이슈에 포함할지? | **Resolved** | **Non-Goal 유지**. 백필은 후속(#804·#811 인접). Session 1. |
| OQ-5 | drop 시 episodic `triple_extracted` success 판정·부분 성공 메타데이터? | **Resolved** | **부분 성공**: 성공 triple만 저장; 실패는 skip+reason; 단일 불량으로 전체 추출 하드 실패 금지. #805 metadata 정렬. Session 1. |
| OQ-6 | 목표 폴백률 수치(예: 신규 <1%)를 SC에 고정할지? | **Resolved** | **SC-001**: 게이트 경로 테스트 form-(2) **0%**. **SC-006**: 라이브 신규 **< 1%** ops 목표(CI flaky 금지). Session 1. |
| OQ-7 | 전부 필터 시 episodic 추출 상태? | **Resolved** | Primary 성공 유지 + skip metadata; remember 경로 실패 전파 없음. Session 2. |
| OQ-8 | #804 FR-001b / 사전 확장 / kg_triple 스키마? | **Resolved** | FR-001b 불변; 사전 대규모 확장 Non-Goal; kg_triple 스키마 변경 없음·게이트 통과 값만 upsert. Session 2. |

## Brainstorm Log

### Session 1 — 2026-09-04 (OQ-1..OQ-6 일괄 권장안 확정)

**Path**: Architectural (기존 `spec.md`에 반영; `docs/superpowers/` 미사용).
**Mode**: 인간 질문 없이 권장 옵션 자동 선택.

| ID | Choice | Rationale |
|----|--------|-----------|
| OQ-1 | Drop (no head-word heuristic) | 실측 형태 (2)는 구·비한글 종결; 헤드워드 추출은 brittle하고 오탐 시 semantic 오염. |
| OQ-2 | Hangul OOV single-token iff reassembly OK | 유한 사전만 강제하면 정상 신규 동사(`배포함` 등)를 대량 drop; `buildTripleSentence`가 이미 재조립 가능 여부를 판정. |
| OQ-3 | CLI npm script | `memory:repair-triple-sentences` / `memory:quarantine-065`와 운영 패턴 일치; HTTP 표면 최소(YAGNI). |
| OQ-4 | Non-Goal backfill | 범위 폭발·#804/#811과 중복; 유입 차단이 선행 가치. |
| OQ-5 | Partial success + structured reasons | Principle V·#805; 한 bad predicate로 episodic 전체 실패는 과도. |
| OQ-6 | 0% tests + <1% ops | CI는 합성 0%로 deterministic; 라이브 <1%는 측정 가능 ops 목표. |

**Spec deltas**: Goals/Non-Goals 수치화; US1 시나리오 4–5; US2 CLI 명시; US3 부분 성공;
FR-001/002 재작성; FR-005 CLI; FR-007 reason 집합; **FR-009** 추가; **SC-006**,
**SC-007** 추가; Edge Cases 표 초안; OQ-1..6 Resolved.

### Session 2 — 2026-09-04 (잔여 엣지·교차 이슈)

**Probes**: dictionary growth, empty-after-filter, #804 form-2 exclusion,
kg_triple upsert, logging reason codes, synthetic fixtures only,
boundary/error/scale/security/UX-ops coverage.

| Topic | Choice | Rationale |
|-------|--------|-----------|
| Dictionary growth | Non-Goal | 게이트가 사전 확장을 전제하지 않음; `addPredicate`는 후속 운영. |
| Empty after filter | Soft success + skip metadata | FR-009/OQ-7; primary 경로 보호. |
| #804 FR-001b | Unchanged | 격리 범위 변경은 Non-Goal; 본 이슈가 신규 형태 (2)를 줄여 제외 근거 보호. |
| kg_triple upsert | Gated predicates only; no migration | FR-004; Principle III 해당 없음. |
| Reason codes | Fixed trio | `predicate_empty` \| `predicate_canonicalize_failed` \| `predicate_reassembly_failed`. |
| Fixtures | Synthetic only | Constitution Additional Constraints; **FR-010**. |
| Admin telemetry | Optional follow-up | OQ-3 재확인. |
| Security (CLI) | Aggregates + capped samples | FR-006; 절대 경로 비노출. |

**Spec deltas**: Edge Cases를 category 표로 확장; Non-Goals에 사전 확장·admin
endpoint; **FR-010**; OQ-7·OQ-8 Resolved; SC-001에 “gated path 0%” 명시.

### Session 3 — 2026-09-04 (정합성 검증 — 추가 브레인스토밍 불필요)

Constitution Principles I–V / AGENTS #768 대조:

| Gate | Alignment |
|------|-----------|
| I Test-First | SC-001/002/007 + 도메인 fixture로 Red-Green 가능 |
| II MCP contracts | FR-008 유지 |
| III Schema | 마이그레이션 없음 |
| IV Quality gates | SC-004 |
| V Observability | FR-007/009; 주 경로 비중단 |
| #768 | FR-003: `buildTripleSentence` only; 원문 폴백 금지 |

Self-review: `[NEEDS CLARIFICATION]` 없음; Open Questions 전부 Resolved;
Goals ↔ Non-Goals ↔ FR ↔ SC 모순 없음.

**Verdict**: further brainstorm **not needed**. Status → **Ready for Planning**.
