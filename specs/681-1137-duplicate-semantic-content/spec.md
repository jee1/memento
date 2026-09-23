# #1137 — triple 폴백이 만든 중복 본문 semantic 기억 설계

**Issue**: #1137 (bug, priority/high)
**Branch**: `issue/1137-duplicate-semantic-content`
**작성일**: 2026-09-24
**관련**: #768 (triple 재조립·원문 폴백), #813 (predicate 게이트), #804 (형태(2) 격리 제외), #805 (episodic→semantic 변환)

---

## 1. 문제

triple 재조립에 실패한 semantic 기억이 원본 episodic 본문을 content로 공유한다.
한 episodic에서 뽑은 triple k개가 모두 재조립에 실패하면 **같은 본문의 semantic 행 k개**가 생긴다.
`memory_injection`은 content 기준 중복 제거가 없어, 토큰 예산을 한 기억의 사본으로 소모한다.

이슈 본문의 재현: `memory_injection(max_memories=5)`가 글자까지 동일한 5건을 반환했고,
토큰 예산 713을 사본 5개가 전부 썼다. 정작 찾던 기억은 반환되지 않았다.

### 원인 사슬

1. `semantic-memory-scoring.ts:21-42` `tripleToNaturalLanguage`의 폴백이 **triple에 의존하지 않는다** —
   재조립 실패 시 `fallbackText`(= 원본 episodic 본문)를 그대로 content로 쓴다.
2. 중복 차단 가드 `hasEligibleExactCandidate`(`semantic-memory-crud.ts:89`, 정의 `:418`)는
   subject/predicate/object만 비교한다. triple이 서로 다르면 content가 같아도 통과한다.
3. 재조립 실패 조건은 `triple-sentence.ts:41-42` `conjugatePredicate`가 **한글로 끝나지 않는 predicate에
   `null`을 반환**하는 것. 이 저장소의 기억은 한국어 본문에 영문 predicate가 붙는 게 일반적이라
   폴백이 예외가 아니라 기본 경로였다.
4. 읽기 측: `knowledge-context-bundle-builder.ts`에 content 기준 중복 제거가 없다.

---

## 2. 실측 (2026-09-24, `~/.memento/data/memory.db`, `mode=ro`)

### 2.1 쓰기 측 누수는 #813으로 이미 닫혔다

| 지표 | 값 |
|---|---|
| #813 게이트 머지 | `3e3b31b0` **2026-09-05** |
| 영문 predicate semantic 행 마지막 생성 | **2026-09-04T22:24:37Z** |
| 게이트 이후 생성된 semantic 행 | 832 |
| └ 그 중 중복 본문 | **0** |
| 중복 본문 semantic 행 (전체, 과거 부채) | **1,566** |

이슈 본문의 "2026-09에 308행 — 지금도 쌓인다"는 9/01~9/04, 즉 게이트 이전 물량이다.
게이트 이후 20일 832행에 중복 0건.

**구조적 이유**: 중복을 만든 경로는 `semantic-memory-update-pipeline.ts:212`의
`scoring.prepareNormalizedTriple`이고, 이 함수는 canonicalize 실패를 통과시킨다
(`predicateCanonicalized: false`로 표시만 하고 `predicate: predicateResult.canonical` = 원본을 그대로 실어 보낸다,
`semantic-memory-scoring.ts:61-83`). #813의 게이트는 그 앞단인
`triple-extraction-service.ts:363` `normalizer.normalizeWithReport`에 있어서 영문 predicate를 drop하고,
그래서 파이프라인까지 도달하지 않는다.

→ 이 이슈의 **남은 실제 과제는 (a) 기존 부채 1,566행과 (b) 읽기 측 중복 제거**이며,
쓰기 경로 수정은 회귀 방지를 위한 다중 방어선이다.

### 2.2 영문 predicate 분포 (과거 데이터)

| 지표 | 값 |
|---|---|
| 서로 다른 영문 predicate | 664 |
| 총 행 | 1,476 |
| 상위 20개가 덮는 행 | 523 (35%) |
| 상위 50개가 덮는 행 | 687 (47%) |
| 1회만 등장하는 predicate | 489 |

상위 20개를 품사로 다시 분류하면 커버리지 해석이 달라진다.

| 분류 | predicate | 행 수 |
|---|---|---|
| 동사 (한글 canonical 매핑 가능) | includes 71, resolved 29, execute 18, closes 17, contains 16, pass 14, updated 13, requires 13, uses 9, fix 9, added 8, closed 8 | **225 (15%)** |
| 계사·속성 (매핑 불가, §7 참조) | is 140, status 98, are 20, result 10, date 9, description 7, action 7, artifacts 7, on 7, in 6 | **311 (21%)** |

---

## 3. 핵심 발견 — 상류는 프롬프트다

`PredicateCanonicalizer`의 사전은 **이미 영문→한글 canonical 매핑을 한다**
(`predicate-canonicalizer.ts:27-89`: `use`→`사용함`, `create`→`생성함`, `include`→`포함함` …).
실패의 원인은 활용 규칙 부재가 아니라 **사전에 없는 변형**이다 — `use`는 있고 `uses`는 없다.

그리고 게이트의 실질 통과 조건은 사전 등재가 아니다. `triple-normalizer.ts:88-95`:

```
canonicalize 실패 → 공백 없는 한글 종결 단일 토큰이고 buildTripleSentence 성공이면 accept
```

프롬프트 예시의 `개발함`·`만족함`은 사전에 없는데도 이 경로로 통과한다.
즉 **"한글 ㅁ형 단일 토큰"이면 사전과 무관하게 통과**한다.

그런데 `packages/memento-core/prompts/triple-extraction.txt`는 **predicate 어휘를 전혀 제약하지 않는다.**
지시문은 "주어와 목적어 간의 관계나 행동"뿐이고, 형태 제약은 예시 4개에 암시적으로만 있다.
입력이 영문 식별자 가득한 한국어 기술 노트면 gpt-4o-mini가 `stores`·`uses`·`status`를 뱉는 것이 자연스럽다.

→ 사전 664항목을 확장하는 것이 아니라 **프롬프트에서 형태를 강제**하는 것이 근본이고 가장 짧다.
코드 변경 0줄이며, 지금 drop되는 triple이 KG에도 들어가지 못하는 문제까지 같이 완화된다.

### LLM 미사용 시

triple 추출은 LLM 전용 경로다. `triple-extraction-service.ts:336` `invokeTripleProviderWithFallback`가
provider 3종(openai/gemini/ollama) 안에서만 돌고, 전부 실패하면 `:343`에서 throw →
triple 0건 → semantic 기억 0건. 규칙 기반 추출 폴백은 없다.
따라서 LLM이 없는 구성에서는 이 이슈의 중복이 애초에 발생하지 않는다. 별도 처리 불필요.

---

## 4. 설계

### FR-001 (B1) — 프롬프트 predicate 제약 (주 레버, 코드 0줄)

`packages/memento-core/prompts/triple-extraction.txt`에 추가:

- predicate는 **한국어 ㅁ 명사화형 단일 토큰** (`사용함`·`정의됨`·`포함함`). 공백 불가, 영문 불가
- canonical 21개 목록을 프롬프트에 인라인. 가능하면 그중에서 고르고, 없으면 같은 형태로 새로 만든다
  (게이트가 OOV 한글 ㅁ형을 허용하므로 새 동사도 통과한다)
- 적절한 동사가 없는 관계(`status`·`date` 같은 속성 라벨)는 **triple을 추출하지 않는다**
- 나쁜 예/좋은 예 대조: `stores` ✗ → `저장함` ✓ / `status` ✗ → 추출 생략

### FR-002 (B2) — canonicalizer 보강 (2차 방어선)

`predicate-canonicalizer.ts`:

- `canonicalize`에 영문 어간 재시도: 직접 조회 실패 + ASCII 키면 `-s`/`-es`/`-ed`/`-ing` 제거 후 재조회
  (`uses`→`use`→`사용함`). 기존 영문 동의어 항목이 변형까지 커버하게 된다
- 계사·속성류는 등재하지 않는다 (§7)
- **능동 ㅁ형 canonical만 등재한다.** 피동 `됨`형(`해결됨`)은 `conjugatePredicate`가 `해결됩니다`를 만들지만
  템플릿의 목적격 조사 `를`과 맞지 않아 `A은 B를 해결됩니다`가 된다 (§7의 계사 문제와 같은 뿌리)

어간화만으로 기존 사전이 커버하는 분량과 신규 등재가 필요한 분량을 분리하면:

| 경로 | predicate | 행 수 |
|---|---|---|
| 어간화 + 기존 사전으로 해결 | `includes`→include→포함함 71, `contains`→contain→포함함 16, `updated`→update→업데이트함 13, `uses`→use→사용함 9 | **109 (7.4%)** |
| 신규 등재 필요 | `resolve`→해결함 29, `execute`→실행함 18, `close`→종료함 25(`closes` 17+`closed` 8), `pass`→통과함 14, `require`→필요함(동의어 추가) 13, `fix`→업데이트함(동의어 추가) 9, `add`→추가함 8 | **116 (7.9%)** |

신규 canonical 키 5개(`해결함`·`실행함`·`종료함`·`통과함`·`추가함`)와
기존 키 동의어 추가 2건(`필요함`←require, `업데이트함`←fix)이다.
합산 수율은 과거 데이터 기준 **225행 = 15%**. 역할은 B1이 어겨졌을 때의 backstop이며 주 레버가 아니다.

### FR-003 (A) — 폴백을 triple에 종속시킨다

`semantic-memory-scoring.ts:21-42` `tripleToNaturalLanguage`:

- `fallbackText` 분기와 `FALLBACK_TEXT_MAX_LENGTH`를 제거한다
- 재조립 실패 시 `[subject, predicate, object].join(' · ')`(현재의 최종 폴백)을 반환한다
- `fallbackText` 파라미터를 없애고 `semantic-memory-crud.ts:64`의 `source.content` 인자를 뺀다

프로덕션 호출부는 `semantic-memory-crud.ts:64` **한 곳**뿐이라 파급이 좁다.
원문은 episodic 행에 그대로 있고 `origin_source.context.source_episodic_id`(crud:82)로 추적된다 —
semantic 행이 원문 사본을 들고 있을 이유가 없다.

#768이 이 분기를 넣은 의도는 "망가진 합성 문장을 만들지 말자"였고,
보존 위치가 semantic content여야 한다는 요구는 아니었다. 이 결정 변경을 코드 주석에 #768→#1137로 남긴다.

**부수 효과(의도)**: 형태(2)가 쓰기 경로에서 0이 되어 #813 SC-006(라이브 신규 형태(2) < 1%)을 구조적으로 만족한다.

**갱신할 기존 테스트**: `semantic-memory-scoring.spec.ts:111`·`:118`이 원문 폴백을 단언한다.
삭제가 아니라 새 계약으로 교체하고 결정 변경 근거를 남긴다.

### FR-004 (D) — memory_injection content 중복 제거

`knowledge-context-bundle-builder.ts`에 `dedupeByContent`를 추가하고,
`filterBrokenTripleContent`와 같은 두 지점(overfetch 루프 안, 사후 필터)에 적용한다.
루프 안에 있어야 중복이 걷힌 만큼 `searchLimit`이 확장돼 예산이 굶지 않는다.

- **키**: content를 trim·공백 정규화·말미 `…` 제거 후 **앞 200자**.
  500자로 잘린 사본과 원문 episodic 행이 같은 그룹으로 묶인다
  (증상 보고의 "정작 찾던 원본이 반환되지 않는다"가 이 경우다)
- **그룹 대표**: `finalScore + importance` 최대값 — `summarizeMemories`(:110)와 같은 정렬 키, 동점은 id로 결정
- 제외 건수는 기존 손상 triple 필터와 같은 형식으로 `logger.warn`
- **부수 효과(의도)**: 탈락한 사본은 `updateConsolidationScoreMetadata` 호출(:406)에 도달하지 않아 `recall_count`가 부풀지 않는다

**한계**: 앞 200자 프리픽스는 휴리스틱이다. 앞 200자가 같고 뒤가 다른 별개 기억은 한 건으로 합쳐진다.
실측 사본은 전부 바이트 동일이라 현재 데이터에서 위험이 없고, 정확 비교로 좁히는 것은 언제든 가능하다.
한계와 대안을 코드 주석에 남긴다.

### FR-005 (E) — 기존 1,566행 정리 스크립트

`scripts/repair-duplicate-semantic-content.ts` 신설.
`scripts/repair-triple-sentence-memories.ts` 구조를 재사용한다
(dry-run 기본 → `--apply`, 트랜잭션 UPDATE, 재임베딩은 soft-fail 경고).

1. **대상 선정**: `type='semantic'`, triple 3컬럼 존재, content가 원본 episodic 본문과 일치
   (또는 500자 절단형과 일치). 원문 폴백 형태만 정확히 고른다 —
   `repair-triple-sentences`가 옛 템플릿 문자열 동일성으로 오탐 0을 만든 것과 같은 원리
2. **재렌더**: FR-003의 새 렌더러 적용. FR-002 이후 canonicalize 성공분(~15%)은 한국어 문장으로,
   나머지는 `s · p · o`로 구별된다
3. **완전중복 정리**: 재렌더 후 `(subject, predicate, object, owner_id, project_id)`가 동일한 그룹만
   진짜 중복이다. confidence 최대 1건을 남기고 나머지 soft-delete(`is_deleted=1`)
4. **재임베딩**: content가 바뀐 행만

`npm run memory:repair-duplicate-semantic`으로 등재한다.
운영 문서(§commands.md)에 dry-run 우선 절차를 적는다. 오류·리포트에 절대 경로를 노출하지 않는다.

---

## 5. 성공 기준

| ID | 기준 | 측정 |
|---|---|---|
| SC-001 | 쓰기 경로에서 원문 폴백 content가 생성되지 않는다 | 단위 테스트에서 재조립 실패 triple → `s · p · o`, 형태(2) 0% |
| SC-002 | 같은 원본에서 나온 서로 다른 triple k개가 서로 다른 content를 갖는다 | 단위 테스트 (k=3, 전부 재조립 실패) |
| SC-003 | `memory_injection`이 사본으로 예산을 채우지 않는다 | 통합 테스트: 사본 5 + 별개 1 투입 → 반환 content 전부 상이 |
| SC-004 | 프롬프트 제약이 predicate 형태 준수율을 끌어올린다 | 실 LLM 프로브 before/after (§6) |
| SC-005 | 정리 스크립트 적용 후 중복 본문 그룹 0 | 이슈 본문의 중복 쿼리 재측정 (506 → 0) |
| SC-006 | 기존 게이트·변환 계약 회귀 없음 | `npm run lint` · `type-check` · `test` 전량 통과 |

## 6. 검증

- **실 LLM 프로브 (SC-004)**: 중복을 만든 episodic 본문 20건을 샘플링해 기존/신규 프롬프트로
  gpt-4o-mini를 각각 호출하고, predicate 형태 준수율과 게이트 통과율을 before/after로 비교한다.
  일회성이라 스크래치패드에 두고 커밋하지 않으며, 수치만 이 문서에 기록한다
- **단위**: 어간화, 사전 신규 12종, `tripleToNaturalLanguage` 새 계약,
  `dedupeByContent`(정확 동일·절단 사본·별개 기억 비병합·대표 선택)
- **통합**: `knowledge-context-bundle-builder.spec.ts`에 사본 5건 + 원본 1건
- **스크립트**: dry-run 계획이 대상만 고르는지(오탐 0), `--apply` 후 재중복 0
- **회귀**: `triple-extraction-predicate-gate.spec.ts` · `predicate-gate-persist.spec.ts` ·
  `semantic-memory-quality-persistence.spec.ts` · `semantic-memory-scoring.spec.ts`
- **실데이터 사후**: `--apply` 후 중복 쿼리 재측정

## 7. 범위 밖

- **계사·속성 predicate 지원**: `is`→`임`으로 매핑하면 `conjugatePredicate`가 `입니다`를 만들지만,
  `buildTripleSentence`의 템플릿이 `${subject}은 ${object}를 ${predicate}`라서
  `#1137 은 resolved를 입니다`가 나온다. 조사 `를`이 계사에 맞지 않는다.
  고치려면 predicate 종류별 템플릿 분기가 필요하고 이는 #768 렌더러 재설계다.
  상위 predicate 311행(21%)이 여기 해당하므로 후속 이슈 후보다
- **피동 `됨`형 predicate 지원**: 계사와 같은 조사 불일치 문제다 (`A은 B를 해결됩니다`).
  `resolved`처럼 원문이 피동인 predicate는 능동 canonical(`해결함`)로 매핑해 우회하고,
  템플릿 분기는 계사 지원과 함께 후속으로 다룬다
- **게이트 완화 / long tail 수용**: #813 동결을 유지한다. 489 singleton predicate는 계속 drop
- **importance 0.1 → 0.95 점프**: `calculateImportance`(`semantic-memory-crud.ts:72`) —
  사본이 원본보다 검색 상위를 먹는 축. 원인이 다르다
- **Reflexion procedural 중복** (`Reflexion: recall 실패 기록` 141건, `remember 실패 기록` 47건):
  ReflexionWorker가 같은 제목으로 적재하는 별개 원인
- **#804 격리 규칙 재검토**: 형태(2) 행이 사라지면 FR-001b가 형태(2)를 격리에서 제외한 근거
  ("비중이 작다")가 무의미해진다. 후속으로 다뤄야 한다
- **memory_injection과 recall의 랭킹 차이**: #804 계열에서 이미 다뤘다

## 8. 결정 기록

| 결정 | 근거 | 버린 대안 |
|---|---|---|
| B를 "영문 활용 규칙 추가"가 아니라 "프롬프트 제약 + 어간화"로 재정의 | 사전이 이미 영문→한글 매핑을 하고, 게이트 통과 조건은 한글 ㅁ형이다. 상류가 프롬프트다 | `use → use합니다` 식 영문 활용 — #768이 명시적으로 막은 형태 |
| 원문 폴백 제거 (`s · p · o`만) | 원문은 episodic 행 + `source_episodic_id`로 추적 가능. 사본 저장은 이 이슈 자체 | `s · p · o` + 원문 결합 — 구별은 되지만 같은 원문 k번 저장과 임베딩 노이즈가 남는다 |
| 기존 행은 재렌더 후 완전중복만 soft-delete | triple 정보·KG 관계를 보존한다 | 전부 soft-delete (정보 손실) / 정리 없이 D만 (부채·임베딩 비용 영구 잔존) |
| long tail은 계속 drop | 계사 지원이 렌더러 재설계를 요구한다. 저품질 semantic 유입 위험 | 게이트 완화 — #813 SC 재해석 필요 |
| D 키를 앞 200자 프리픽스로 | 500자 절단 사본과 원문 행을 같은 그룹으로 묶어야 증상이 해소된다 | 정확 동일 비교 — 절단 사본 대 원문 케이스를 놓친다 |
