# Feature Specification: misc — repair export · 손상 필터 · recall/remember -32603

**Feature Branch**: `feature/fix-misc-repair-export-recall-32603`
**Spec Directory**: `specs/665-811-misc-repair-export-recall`
**Created**: 2026-09-05
**Status**: Ready for Planning
**Issue**: [#811](https://github.com/jee1/memento/issues/811)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: #768 (재조립·repair), #781 (함합니다 제외), #804 (격리), #806/#830 (벡터 유사도), #813 (predicate 게이트), #823 (type-param -32603 분리 진단)
**Input**: fix(misc): repair 스크립트 export·손상 필터 위치·recall -32603 정리

## Problem Statement

#811은 Epic #803 조사에서 남은 **잡다한 운영/검색 부채** 네 묶음(+ 후속 댓글 두 건:
remember `-32603`/백틱, hybrid 유사도 residual)이다.

### 1. `memory:repair-triple-sentences` 실행 불가

`AGENTS.md`가 안내하는 복구 경로가 다음으로 죽는다:

```text
SyntaxError: The requested module '@memento/core' does not provide
an export named 'buildTripleSentence'
```

소스 `packages/memento-core/src/index.ts`는 `buildTripleSentence` /
`hasBrokenTripleConjugation`를 export한다. 이 worktree에서는
`packages/memento-core/dist/index.js`가 **부재**하여 stale/미빌드가
유력하다. 스크립트는 CI/smoke 대상이 아니라 회귀가 방치되기 쉽다.
이슈 선택지(#A 격리 후 삭제)는 **채택하지 않음** — 스크립트 유지 +
export 스모크 (OQ-1 Resolved).

### 2. 손상 필터가 검색 후에 동작

`knowledge-context-bundle-builder.ts`는 hybrid 검색 결과에서
`hasBrokenTripleConjugation`으로 **사후 필터**한다. 이미
`maxMemories * (2|6)` overfetch 후에도 손상 행이 shortlist를 채운 뒤
버려져 예산이 비는 현상이 관측됐다(이슈: 8,560건 `됨합니다` 후보
잠식). `#781` 이유로 `함합니다`는 의도적으로 탐지하지 않으며 주입
결과에 남을 수 있다. #804 이후 재평가 권고. **해결 방향**: 조기
필터 + **예산 충족을 보장하는** overfetch(고정 소배수 shortlist만
금지; adaptive expand 또는 검색층 제외) — content fragile SQL `LIKE`
단독 제외는 금지 (OQ-3).

### 3. MCP `-32603` (recall / remember)

- **관측 A**: `include_score_breakdown: true` + type 필터 없이 `recall` →
  `MCP error -32603`. `type: episodic`이면 정상 (1회, 재현 미확인).
- **관측 B** (이슈 댓글): `remember`도 `-32603`. 백틱·정규식 문자를
  평문으로 바꾸면 성공 (1회).
- **조사 기억 (별도 재현)**: `MEMENTO_TYPE_PARAM_MODE=error`에서 type
  누락 시 `RecallInputValidationError`(일반 `Error`) throw.
  `mapToolExecutionErrorToJsonRpc`는 `ZodError`만 `-32602`로 매핑하므로
  검증 오류가 `-32603 Internal error`로 노출된다. REST는 메시지를
  담지만 MCP UI는 Internal error만 보여 "쓰기만 죽었다"로 오해된다.
  (#823과 동일 계열; 본 이슈에서 에러 **코드 매핑**으로 교정.)

관측 A/B와 type-param 경로를 **재현으로 격리**한 뒤 수정 또는
재현 불가 종료. 백틱 가설은 최소 재현 후 실패 시 Non-blocking (OQ-5).

### 4. 조사 도구 부작용 (문서화)

`recall`은 기본 `auto_set_anchor: true`로 앵커 슬롯과
`meta_stats`(recall_count·failure_count)를 변경한다. 진단 프로브가
통계를 오염시킨다. `feedback` 없이 `memory_injection`만 반복하면
고실패 지표가 부풀 수 있다. **코드 강제 없음** — 문서만 (OQ-6).

### 5. 하이브리드 SQL 유사도 변환 분산 (#806 residual R1, 댓글)

`vector-search-hybrid-query.ts`가 SQL에서
`COALESCE(1 - vs.vector_distance, 0)`로 distance→similarity를 하고
`mapHybridResults`는 `clamp`만 한다. #806 FR-020("변환 정의는 저장소
전체에서 유일")과 불일치. 변경은 hybrid query + mapper에 국한 →
**본 PR에 US5 포함** (OQ-4).

## Goals

- `npm run memory:repair-triple-sentences`가 정상 import·dry-run 가능하고
  회귀를 막는 최소 검증이 존재한다 (스크립트 **유지**).
- `memory_injection` 후보 생성에서 손상 triple 문장이 슬롯을 잠식하지
  않도록 필터를 **검색/후보 단계**로 이동한다 (`함합니다` #781 정책 유지).
  검색으로 도달 가능한 정상 후보가 충분하면 `maxMemories`까지 채워야
  한다. 주경로: 조기 필터 + adaptive overfetch(또는 검색층 제외).
  현행 `*2`/`*6` 고정 shortlist + 사후 필터만으로는 불충분하며,
  사후 필터만으로 예산을 비우면 안 된다.
- 클라이언트 입력 검증 실패(type/query 누락 등)는 MCP에서 `-32602
  Invalid params`로 노출되고, 진짜 내부 오류만 `-32603`을 쓴다.
  Zod에서 `type` required로의 스키마 강화는 **본 이슈 비범위**.
  백틱/`include_score_breakdown` 가설은 재현 후 수정 또는 Non-blocking
  종료.
- 진단 프로브 가이드(`auto_set_anchor: false`)를 에이전트 문서에 명시한다
  (hooks에서 feedback 강제 없음).
- (P3, **본 PR 포함**) 하이브리드 경로의 유사도 변환을
  `cosineDistanceToSimilarity`로 단일화한다.

## Non-Goals

- `함합니다`를 `hasBrokenTripleConjugation`에 포함 (#781 유지; 오탐 위험)
- 손상 semantic의 **대량 백필**을 이 이슈에서 강제 실행 (스크립트
  가능·문서화만; apply는 운영자 선택)
- #804 격리 러너 재실행·격리 범위 변경
- #813 predicate 게이트 재설계
- MCP `recall`/`remember` 공개 파라미터 계약 변경 (에러 **코드 매핑**만;
  Zod `type` required 승격 금지)
- injection/feedback **훅 강제** (문서 주의만)
- content에 대한 fragile SQL `LIKE`/wildcard를 **유일한** 손상 제외 수단으로
  사용 (#804 FR-002i 교훈)
- Admin HTTP 신규 엔드포인트
- 벡터 인덱스 재구축·마이그레이션
- repair 스크립트 삭제 (#A 미채택)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 복구 스크립트가 다시 실행된다 (Priority: P1)

운영자가 `npm run build` 후 (또는 워크스페이스 빌드가 최신인 상태에서)
`DB_PATH=... npm run memory:repair-triple-sentences`를 실행하면
`buildTripleSentence` import 오류 없이 dry-run이 완료된다. 회귀 방지를
위해 스크립트 진입점(또는 패키지 export 스모크)이 테스트/CI에 포함된다.
#804 격리로 대상 행이 0이어도 스크립트는 **유지**한다.

**Why this priority**: AGENTS가 안내하는 복구 경로가 죽어 있으면 #768
잔존 행을 고칠 수단이 없다.

**Independent Test**: 클린/최신 build 후 스크립트 `--help` 또는 dry-run
(빈/픽스처 DB) 성공; export 스모크가 `buildTripleSentence` 존재를 단언.

**Acceptance Scenarios**:

1. **Given** `@memento/core` dist가 최신으로 빌드된 상태,
   **When** `npm run memory:repair-triple-sentences` (dry-run) 실행,
   **Then** `buildTripleSentence` named export 오류가 나지 않는다.
2. **Given** export/스모크 테스트,
   **When** CI 또는 로컬 vitest 실행,
   **Then** `@memento/core`가 `buildTripleSentence`와
   `hasBrokenTripleConjugation`를 export한다고 단언한다.
3. **Given** #804 이후 repair 대상 행이 0인 상태,
   **When** 본 이슈를 종료할 때,
   **Then** 스크립트는 삭제하지 않으며 AGENTS 안내와 일치한다
   (0건 dry-run은 exit 0 + 요약).

---

### User Story 2 - 주입 후보에서 손상 문장이 슬롯을 잠식하지 않는다 (Priority: P1)

`memory_injection` / knowledge-context-bundle 경로에서 손상 triple
문장(`정의됨합니다` 등 `hasBrokenTripleConjugation===true`)은 **후보
생성 단계**에서 제외되어, 정상 기억이 `maxMemories` 예산을 채울 수 있다.
정상 `포함합니다`와 `#781` 제외 패턴(`함합니다`)은 기존과 같이 통과한다.
구현 기본안: **조기 필터 + 예산 충족 overfetch**(adaptive expand 상한
포함 가능) 또는 **검색층 제외**. 현행 `maxMemories*(2|6)` shortlist에
사후 필터만 거는 패턴은 **채택하지 않는다**(이슈 재현 경로). 사후
필터는 defense-in-depth로만 허용되며 유일한 예산 보호가 되어서는
안 된다.

**Why this priority**: 사후 필터는 예산 고갈로 주입 품질을 떨어뜨린다.

**Independent Test**: 손상 content가 상위 유사도로 나오도록 픽스처를
넣어도 bundle/prompt에 손상 문장이 없고, 정상 후보가 채워진다.

**Acceptance Scenarios**:

1. **Given** 손상 triple content와 정상 content가 혼재한 DB,
   **When** knowledge-context-bundle / memory_injection이 실행되면,
   **Then** 손상 행은 최종 주입 목록에 없고, 정상 행이 `maxMemories`
   한도까지 우선 채워진다(사후 필터만으로 목록이 비지 않음).
2. **Given** content가 `시스템은 기능을 포함합니다`(정상),
   **When** 동일 경로,
   **Then** 제외되지 않는다.
3. **Given** content가 `#781` 제외 패턴(`함합니다` 계열로 탐지 실패),
   **When** 동일 경로,
   **Then** 기존과 같이 통과한다(탐지 확장 금지).
4. **Given** 후보가 전부 손상이면,
   **When** 주입 실행,
   **Then** 빈 결과 + 구조화 경고 로그(또는 동등 observability)이며
   primary 경로는 throw하지 않는다 (Principle V).
5. **Given** `maxMemories=1`이고 유사도 상위가 손상,
   **When** 주입 실행,
   **Then** overfetch/expand(또는 검색층 제외)로 다음 정상 후보가 채워진다.
6. **Given** 손상 밀도가 높아 `maxMemories*2`(또는 `*6`) shortlist가
   전부 손상이지만 검색으로 도달 가능한 정상 행이 더 아래에 존재,
   **When** 주입 실행,
   **Then** 고정 소배수 shortlist+사후필터만으로 비지 않고, expand
   또는 검색층 제외로 정상 행을 채운다(도달 가능 정상 소진 시에만
   미달+warn).

---

### User Story 3 - 입력 검증 실패는 -32602로 보인다 (Priority: P1)

MCP `tools/call`에서 `recall`/`remember`의 **클라이언트 입력 검증 실패**
(type 누락 in `error` 모드, query 누락 등)는 JSON-RPC `-32602 Invalid
params`와 설명적 `data`/`message`로 반환된다. 판별은 안정적 `name` 또는
공유 에러 클래스를 쓴다 (메시지 문자열 매칭만 금지). Zod에서 `type`을
required로 올리는 것은 본 이슈에서 하지 않는다. 재현된 내부 버그(백틱
등)가 있으면 별도 수정하고, 재현 불가면 Non-blocking으로 본 US를 막지
않는다.

**Why this priority**: `-32603`은 운영 장애처럼 보여 잘못된 완화로 이어진다.

**Independent Test**: type 없는 `recall`/`remember` MCP(또는
`dispatchTool`/`mapToolExecutionErrorToJsonRpc`) 호출이 `-32602`를 반환.
기존 Zod 매핑·Unknown tool `-32601` 회귀 없음.

**Acceptance Scenarios**:

1. **Given** `MEMENTO_TYPE_PARAM_MODE=error` 및 type 없는 recall,
   **When** MCP tools/call,
   **Then** 응답 코드는 `-32602`이고 메시지/데이터에 type 필수 안내가
   포함된다 (`-32603` 아님).
2. **Given** type 없는 remember (동일 모드),
   **When** MCP tools/call,
   **Then** 동일하게 `-32602`.
3. **Given** 백틱·정규식 content remember 최소 재현 시도,
   **When** 재현 성공,
   **Then** 근본 원인을 수정하고 회귀 테스트를 남긴다; **재현 실패 시**
   스펙/이슈에 "재현 불가"로 닫고 본 US를 막지 않는다 (Non-blocking).
4. **Given** `include_score_breakdown: true` + type 생략 recall,
   **When** 재현,
   **Then** type 누락이면 US3-1로 설명되고, type 있어도 터지면 별도
   버그로 수정한다.

---

### User Story 4 - 진단 프로브 문서화 (Priority: P2)

기여자/에이전트가 진단용 `recall`을 돌릴 때 `auto_set_anchor: false`를
쓰도록 `AGENTS.md` 또는 `docs/agents/agent-workflow.md`에 명시한다.
`memory_injection` 반복 + feedback 부재로 고실패가 부푸는 문제는
문서에서 주의로 언급한다. **코드/훅에서 feedback 강제 없음**.

**Why this priority**: 통계 오염은 코드 버그가 아니라 운영 습관 문제.

**Independent Test**: 문서에 해당 문장이 존재하고 링크/위치가 워크플로
섹션에 있다.

**Acceptance Scenarios**:

1. **Given** 에이전트 워크플로 문서,
   **When** 진단 프로브 절을 읽으면,
   **Then** `auto_set_anchor: false` 권장이 명시된다.
2. **Given** 동일 문서,
   **When** feedback 없는 반복 injection을 언급하면,
   **Then** high_failure_count 부풀림 주의가 있다.

---

### User Story 5 - 하이브리드 유사도 변환 단일화 (Priority: P3, **본 PR 포함**)

하이브리드 검색 SQL은 distance를 그대로 내보내고, similarity 변환은
`shared/utils/vector-similarity.ts`의 `cosineDistanceToSimilarity`만
사용한다 (`mapHybridResults`가 clamp-only에서 단일 유틸 경로로 전환).
기존 테스트·랭킹 해시 계약은 유지한다. 변경 범위는
`vector-search-hybrid-query.ts` + `vector-search-result-mapper.ts`
(+ 관련 스펙)에 국한한다.

**Why this priority**: #806 residual; 동작 정상, 부채성 — 단 범위가
작아 본 PR에 포함.

**Independent Test**: hybrid query 단위/통합 테스트가 SQL
`1 - distance` 부재(또는 매퍼 단일 경로)를 검증하고 유사도 값이
`clamp(1-d,0,1)`과 일치.

**Acceptance Scenarios**:

1. **Given** 하이브리드 벡터 쿼리 빌더,
   **When** SELECT 절을 검사하면,
   **Then** distance→similarity 산술이 SQL에 없고 매퍼/공유 유틸에서만
   수행된다.
2. **Given** 기존 vector similarity 스펙,
   **When** 테스트 실행,
   **Then** #806 척도 계약이 깨지지 않는다.

---

### Edge Cases

| Category | Case | Expected |
|----------|------|----------|
| Boundary | dist 없음 / stale | build 안내 또는 스모크 실패로 조기 발견; silent pass 금지 |
| Boundary | repair 대상 0건 | dry-run 성공, exit 0, "nothing to repair"류 요약; 스크립트 유지 |
| Boundary | 후보 전량 손상 | 빈 주입 + warn; throw 금지 |
| Boundary | maxMemories=1 + 상위가 손상 | overfetch/expand/검색층 제외로 다음 정상 후보 채움 |
| Boundary | overfetch/expand 상한 후에도 정상 부족 | 가능 수만큼 채우고 예산 미달은 warn (throw 금지) |
| Error | type 누락 (error mode) | `-32602` via stable `name`/공유 클래스 |
| Error | 진짜 DB/초기화 실패 | 계속 `-32603` |
| Error | Zod 스키마 실패 | 기존 `-32602` 유지 |
| Error | 백틱 remember 미재현 | Non-blocking close; US3 매핑 완료를 막지 않음 |
| Scale | 손상 비율 높은 DB | 고정 `*2`/`*6` shortlist+사후필터만으로 예산 고갈 재발 금지; adaptive expand(문서화된 상한) 또는 검색층 동일 predicate 제외 |
| Scale | DiD 사후 필터 | optional 허용; **유일한** 예산 보호·사후만 shortlist 재스캔으로 채우기 금지 (FR-003) |
| Scale | content LIKE 단독 제외 | **금지** (wildcard injection / #804 FR-002i) |
| Security | DB_PATH 로그 | 절대 경로 비노출 (기존 CLI 관례) |
| UX | 진단 recall | 문서: `auto_set_anchor: false` |
| UX | feedback 강제 | 본 이슈에서 hooks/코드 강제 없음 |
| Compat | `함합니다` | #781 — 필터 확장 금지 |
| Compat | MCP 파라미터 | 스키마/필드 추가·Zod type required 없이 에러 코드만 교정 |

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `@memento/core` public export에 `buildTripleSentence` /
  `hasBrokenTripleConjugation`가 포함되고, repair 스크립트가 이를
  import해 실행 가능해야 한다. 스크립트는 #804 이후 대상 0건이어도
  **삭제하지 않는다**.
- **FR-002**: export 존재를 검증하는 스모크 테스트(또는 동등 CI 검사)를
  추가한다. 스크립트 전체 E2E는 필수 아님.
- **FR-003**: knowledge-context-bundle(및 동일 필터를 쓰는 injection
  경로)은 손상 triple 문장을 **검색 결과 사후가 아닌 후보 생성/조회
  단계**에서 제외한다. **기본 구현**: 조기 필터 + 예산 충족
  overfetch(필요 시 adaptive expand, 상한은 plan에서 문서화), 또는
  검색층에서 동일 predicate로 제외. **채움 보장**: 검색으로 도달
  가능한 정상(비손상) 후보가 `maxMemories` 이상이면 최종 목록은
  손상 없이 그 한도까지 채워야 한다. 현행 `maxMemories*(2|6)`
  shortlist에 사후 필터만 적용해 비우는 패턴은 회귀로 본다. content
  fragile SQL `LIKE`/wildcard를 **유일한** 제외 수단으로 쓰지 않는다.
  사후 필터는 defense-in-depth로만 허용되며 **사후만으로 예산을
  비우면 안 된다**.
- **FR-004**: `hasBrokenTripleConjugation` 의미·`함합니다` 제외(#781)를
  변경하지 않는다.
- **FR-005**: `mapToolExecutionErrorToJsonRpc`(또는 dispatch 경계)는
  recall/remember **입력 검증 오류**를 `-32602`로 매핑한다. 매핑 대상
  판별은 안정적 신호(`name`, 공유 에러 클래스, 또는 명시 코드)를
  쓴다 — 메시지 문자열 매칭만으로 충분하다고 보지 않는다. Zod에서
  `type`을 required로 올리는 것은 본 이슈 Non-Goal.
- **FR-006**: type/`query` 누락 재현 테스트를 서버 또는 dispatch
  레이어에 추가한다.
- **FR-007**: 백틱·`include_score_breakdown` 가설은 최소 재현을
  시도하고, 성공 시 수정+테스트, 실패 시 문서화 후 **Non-blocking**
  (US3 완료를 막지 않음).
- **FR-008**: `docs/agents/agent-workflow.md` 및/또는 `AGENTS.md` §3.1에
  진단 시 `auto_set_anchor: false`와 injection/feedback 주의 문구를
  추가한다. feedback/injection **훅 강제 코드는 추가하지 않는다**.
- **FR-009** (P3, **본 PR 포함**): 하이브리드 SQL의 `1 - distance`
  변환을 제거하고 `cosineDistanceToSimilarity`로 단일화한다. 범위는
  hybrid query + mapper(+스펙)에 국한한다. US1–4와 동일 PR에서 완료.

### Key Entities

- **Broken triple content**: `hasBrokenTripleConjugation(content)===true`
  인 semantic(등) 본문.
- **Input validation error**: 클라이언트가 고칠 수 있는 파라미터 오류
  (`RecallInputValidationError` 및 remember 동등물; 안정적 `name`/
  공유 클래스).
- **JSON-RPC tool error**: `-32602` (Invalid params) vs `-32603`
  (Internal error).

## Success Criteria *(mandatory)*

- **SC-001**: 최신 build 후 `memory:repair-triple-sentences` dry-run이
  named-export SyntaxError 없이 종료한다.
- **SC-002**: export 스모크 테스트가 CI에서 통과한다.
- **SC-003**: 손상 혼재 픽스처(고정 `*2`/`*6` shortlist가 손상으로
  가득 차도 하위에 정상이 있는 경우 포함)에서 injection/bundle이
  손상 문장 없이 `maxMemories`를 채운다(또는 도달 가능 정상 수만큼);
  사후 필터·고정 소배수 shortlist만으로 목록이 비지 않음을 검증한다.
- **SC-004**: type 없는 recall/remember MCP(또는 동등 dispatch)가
  `-32602`를 반환하는 테스트가 통과한다.
- **SC-005**: `npm run lint` · `type-check` · 관련 `npm test` 통과
  (Principle IV). 프로덕션 코드 변경 시 graphify 재빌드.
- **SC-006**: 진단 프로브 문서 문장이 저장소에 존재한다.
- **SC-007** (P3): 하이브리드 경로 단일화 테스트 통과 (본 PR 필수;
  residual 연기 금지).
- **SC-008**: 백틱 가설 — 재현 성공 시 수정+테스트, 실패 시 이슈/스펙에
  "재현 불가·Non-blocking" 기록.

## Assumptions

- #804 격리가 일부 손상 행을 줄였을 수 있으나, repair 스크립트와
  injection 필터는 당분간 유지한다 (OQ-1 Resolved: Keep).
- MCP 공개 스키마에 `type`을 Zod required로 올리는 것은 호환성 검토가
  필요하므로, **에러 매핑 교정**만 본 이슈에서 한다 (OQ-2 Resolved).
- Principle II: 에러 코드를 검증 실패에 맞게 고치는 것은 breaking이
  아니라 계약 정정으로 본다 (클라이언트가 `-32603`에 의존하면 안 됨).
- US5는 hybrid query·mapper에 국한된 소규모 diff로 본 PR에 포함한다
  (OQ-4 Resolved).
- 손상 제외의 주경로는 조기 필터 + 예산 충족 overfetch(adaptive
  expand 가능) 또는 검색층 제외이며, 고정 `*2`/`*6`+사후필터와
  content LIKE 단독은 쓰지 않는다 (OQ-3 Resolved; #804 FR-002i;
  Session 2 보강).

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| OQ-1 | repair 스크립트 유지 vs #A 격리 후 삭제? | Resolved | **Keep** 스크립트 + export 스모크. 격리로 대상 0건이어도 삭제하지 않음 (AGENTS 복구 경로·미래 회귀). |
| OQ-2 | `-32602` 매핑만 vs Zod에서 type required? | Resolved | **에러 코드 매핑**만 (`name`/공유 클래스). Zod `type` required는 호환 표면이 커 본 이슈 Non-Goal. |
| OQ-3 | 손상 필터: SQL WHERE vs overfetch+조기 필터? | Resolved | **조기 필터 + 예산 충족 overfetch**(adaptive expand 상한 가능) 또는 검색층 제외. 현행 `*2`/`*6` shortlist+사후필터 금지. content fragile SQL LIKE 단독 금지 (#804 FR-002i). 사후 필터는 DiD optional; 유일한 예산 보호 금지. (Session 2: 채움 보장 명시) |
| OQ-4 | US5(유사도 SQL 단일화)를 본 PR에 포함? | Resolved | **Include**. `vector-search-hybrid-query.ts` + mapper 국한 소규모 diff 확인. |
| OQ-5 | 백틱 remember 재현 실패 시 범위? | Resolved | 최소 재현 시도; **미재현 시 Non-blocking** close. US3 매핑 완료를 막지 않음. |
| OQ-6 | 문서만 vs injection 훅의 feedback 강제? | Resolved | **Docs only**. hooks/코드에서 feedback 강제 없음. |

## Brainstorm Log

### Session 1 — 2026-09-05 (auto-recommend-all)

**Path**: Architectural (기존 Spec Kit `spec.md`에 in-place 반영; `docs/superpowers/` 미작성).
**Constitution**: v1.3.0 — Principles I–V 충돌 없음 (에러 코드 정정=II 계약 정정; 빈 주입 soft-fail=V; 테스트·품질게이트=I/IV).

| Category | Decision | Rationale |
|----------|----------|-----------|
| Boundary | repair 유지·0건 dry-run OK; stale dist→스모크 실패; maxMemories=1 overfetch; 전량 손상→empty+warn | 복구 경로·예산·Principle V |
| Error | validation→`-32602` via stable name/class; Zod 유지; 내부→`-32603`; 백틱 Non-blocking | 관측된 type-param 경로가 주원인; Zod required는 별도 호환 이슈 |
| Scale | overfetch+early filter; LIKE-only 금지 | #804 wildcard 교훈; 사후만이면 예산 고갈 재발 |
| Security | DB_PATH 절대경로 비노출 유지 | 기존 CLI 관례 |
| UX | 문서 `auto_set_anchor: false`; feedback 강제 없음 | 통계 오염은 운영 습관; 제품 훅은 별 이슈 |

**OQ resolutions**: OQ-1 Keep · OQ-2 mapping-only · OQ-3 overfetch/early · OQ-4 include US5 · OQ-5 Non-blocking · OQ-6 docs-only.

**Another session needed?** **NO** — 전 OQ Resolved, 구현 경계·Non-Goals·SC가 계획에 충분.
**Verdict**: `BRAINSTORM_COMPLETE` → Status `Ready for Planning`.

### Session 2 — 2026-09-05 (challenge pass)

**Path**: Challenge / self-review vs #811 body + comments (repair export, post-search filter, recall/remember `-32603`, diagnostic docs, hybrid residual). Auto-recommend clarifications; OQ 재오픈 없음.

| Finding | Action |
|---------|--------|
| 이슈 증상이 이미 `*2`/`*6` overfetch+사후필터인데도 shortlist 고갈 — Session 1 FR-003이 "overfetch"만 말해 현행 회귀를 허용할 수 있음 | FR-003·Goals·US2-6·SC-003·Edge·OQ-3 해상 문구에 **채움 보장** + 고정 소배수 shortlist 금지 + adaptive expand/검색층 제외 명시 |
| Edge "JS 사후만 이중 스캔 금지" vs DiD 사후 필터 모호 | DiD optional 허용·유일한 예산 보호 금지로 분리 |
| Problem "후속 댓글 한 건" vs 실제 두 건 | 문구 수정 |
| hybrid 파일 경로 / US1–5 / -32602 / docs / Non-Goals | 이슈·코드와 일치 — 변경 없음 |
| OQ-1..6 | 유지 Resolved (강한 반증 없음) |

**Another session needed?** **NO** — 보강은 계획 가능한 요구사항 명확화; 신규 OQ 없음.
**Verdict**: `BRAINSTORM_COMPLETE` → Status `Ready for Planning` 유지.

### Session 3 — 2026-09-05 (final check)

**Path**: Final readiness pass (full re-read; no new categories; Sessions 1–2 결정 재확인).

| Check | Result |
|-------|--------|
| Status | `Ready for Planning` 유지 |
| Open Questions | OQ-1..6 전부 Resolved; Open 행 없음 |
| FR-003 / Goals / US2 / SC-003 / Edge Scale / Assumptions | 채움 보장·고정 소배수 shortlist 금지·adaptive expand/검색층 제외·DiD 사후만 금지 — 상호 일치 |
| US3/5 · FR-005..009 · Non-Goals · SC | `-32602` 매핑·US5 본 PR·docs-only·스크립트 Keep — 모순 없음 |
| Material wording | 불필요 |

**Another session needed?** **NO** — final check — no material changes; brainstorm complete.
**Verdict**: `BRAINSTORM_COMPLETE` → Status `Ready for Planning` 유지. Next: `/speckit.plan`.

## Out of Scope / Follow-ups

- `함합니다` 탐지 재설계 (#781 follow-up)
- 손상 행 전수 repair apply 운영 런
- feedback_quality 훅 강제 (별도 제품 이슈)
- Zod `type` required 승격 (호환성 별도 이슈; #636 롤아웃과 조율)
- 백틱 remember — 재현 시에만 본 PR에서 수정; 미재현 시 follow-up 없음(기록만)
