# Feature Specification: 짧은 다개념 검색이 텍스트 후보를 잃는다

**Feature Branch**: `660-807-fts-or-prefix`
**Created**: 2026-08-29
**Status**: Implemented (pending commit/PR — ready for review)
**Issue**: [#807](https://github.com/jee1/memento/issues/807)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: #785, #787, #806, #808
**Input**: User description: "https://github.com/jee1/memento/issues/807"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 짧은 다개념 질문이 텍스트 후보를 얻는다 (Priority: P1)

사용자가 짧게 여러 개념을 나열해 검색한다(예: 주제·기법·대상이 한 문장에 함께 들어감). 지금은 짧은 질문이 모든 단어를 한 문서에 동시에 요구하는 방식으로 텍스트 후보를 모아, 실제로는 관련 기억이 있어도 텍스트 쪽이 0건이 된다. 그 결과 벡터만으로 순위가 잡히고 상위가 무관해진다. 사용자는 짧고 정확한 질문일수록 결과가 나빠지는 경험을 한다.

**Why this priority**: 후보 단계에서 텍스트 증거가 사라지면 이후 순위 조정으로 복구할 수 없다. 실측에서 네 단어 동시 포함 문서는 0건이었고, 단어 합집합은 수백 건이었다. 이 스토리가 해결되지 않으면 나머지 품질 작업이 잘못된 후보 풀 위에서 측정된다.

**Independent Test**: 여러 개념이 한 문서에 동시에 없는 고정 픽스처에 짧은 다개념 쿼리를 던졌을 때, 텍스트 후보 수가 0보다 크고 관련 문서가 후보에 포함되면 해결이다.

**Acceptance Scenarios**:

1. **Given** 각 개념 단어가 서로 다른 기억에만 흩어져 있고 네 단어를 모두 담은 기억은 없는 상태, **When** 그 네 단어로 짧은 검색을 하면, **Then** 텍스트 후보 수가 0보다 크다.
2. **Given** 동일 픽스처, **When** 검색하면, **Then** 각 개념과 부분적으로라도 맞닿은 관련 기억이 텍스트 후보에 포함된다.
3. **Given** 긴 질문(개념이 많아 기존에도 합집합 방식이었던 부류), **When** 검색하면, **Then** 기존에 텍스트 후보를 내던 동작이 회귀하지 않는다.
4. **Given** 한 단어짜리 짧은 질문, **When** 검색하면, **Then** 그 단어와 맞는 기억이 텍스트 후보로 남는다.

---

### User Story 2 - 조사·활용이 붙은 표현도 텍스트로 찾을 수 있다 (Priority: P1)

사용자가 한국어로 검색할 때, 저장된 기억에는 "가중치는"처럼 조사가 붙은 형태가 있고 질문에는 "가중치"만 있을 수 있다. 지금은 표면형이 조금만 달라도 텍스트 매치가 빠져, 같은 개념인데도 텍스트 후보에서 탈락한다. 사용자는 조사 유무 때문에 관련 기억이 안 나오는 경험을 한다.

**Why this priority**: 다개념 AND 문제와 별개로, 한국어 표면형 불일치가 토큰당 10~20%대 손실을 만든다. 합집합만으로는 이 손실이 남고, 접두 확장이 그 간극을 메운다는 실측이 있다.

**Independent Test**: 본문에 조사가 붙은 형태만 있고 질문에는 어간이 있는 픽스처에서, 교정 후 해당 기억이 텍스트 후보에 들어오면 해결이다.

**Acceptance Scenarios**:

1. **Given** 기억 본문에 조사가 붙은 표기만 있고 질문에는 같은 어간만 있는 상태, **When** 검색하면, **Then** 그 기억이 텍스트 후보에 포함된다.
2. **Given** 동일 어간을 공유하지만 의미가 다른 긴 단어가 함께 있는 코퍼스, **When** 접두 확장을 쓰는 검색을 하면, **Then** 명백히 무관한 장황 매치만으로 상위가 독점되지 않도록 순위 단계에서 걸러질 여지가 있다(스토리 3과 함께 검증).
3. **Given** 영어 등 조사 융합이 없는 질문, **When** 검색하면, **Then** 기존 텍스트 후보 품질이 허용 범위 안에서 유지된다(스토리 4).

---

### User Story 3 - 텍스트 후보가 늘어도 상위 결과가 관련성을 유지한다 (Priority: P1)

운영자는 텍스트 후보를 넓히면 잡음도 늘어난다는 것을 안다. 합집합·접두 확장 후에는 후보 수는 많아지지만, 최종 상위 결과는 여전히 질문과 관련된 기억이 차지해야 한다. 벡터 점수가 절대 척도일 때(선행 #806) 그 잡음을 걸러낼 수 있는지 ablation으로 확인한다.

**Why this priority**: 이슈가 명시한 위험은 recall↑·precision↓이다. 후보만 늘리고 상위가 더 나빠지면 사용자 체감은 개선이 아니다. #806 없이 벡터 점수로 잡음을 판정하면 실험이 왜곡된다.

**Independent Test**: 동일 픽스처에서 교정 전후 상위 결과의 관련성(관련 기억이 상위권에 있는지)을 비교하고, 텍스트 후보가 늘었는데도 상위가 무관해지지 않으면 통과다.

**Acceptance Scenarios**:

1. **Given** #806이 반영된 절대 벡터 점수 환경과 짧은 다개념 쿼리, **When** 합집합·접두 후보를 ablation하면, **Then** 텍스트 후보 수는 교정 전보다 크고, 상위 결과에 관련 기억이 포함된다.
2. **Given** 동일 ablation, **When** 랭킹 가중치 설정값을 바꾸지 않은 채 비교하면, **Then** 정밀도 하락이 순위 단계에서 흡수되는지 여부가 기록되고, 흡수되지 않으면 기본값으로 채택하지 않는다.
3. **Given** 채택된 결합 방식, **When** 짧은 다개념 쿼리와 긴 쿼리를 각각 실행하면, **Then** 둘 다 관련 기억을 상위권에 올린다.

---

### User Story 4 - 영어 벤치마크가 회귀하지 않는다 (Priority: P1)

품질 담당자는 한국어 다개념 문제를 고치면서 영어 세션 검색 벤치마크가 나빠지지 않기를 원한다. 결합자·접두 변경이 영어 질문의 상위 적중을 깎으면 안 된다.

**Why this priority**: 이슈 검증 항목에 영어 회귀 부재가 명시되어 있다. 한국어만 개선되고 영어가 무너지면 전역 기본값으로 채택할 수 없다.

**Independent Test**: 기존 영어 벤치마크(또는 그 합성 대체 픽스처)에서 Recall/MRR이 허용 회귀 한도를 넘지 않으면 통과다. 원본 비재배포 코퍼스는 커밋하지 않는다.

**Acceptance Scenarios**:

1. **Given** 기존 영어 세션 검색 평가 절차, **When** 채택된 결합 방식으로 재실행하면, **Then** 핵심 지표가 허용 회귀 한도 이내이다.
2. **Given** 평가 산출물, **When** 저장소에 남기면, **Then** 원본·파생 코퍼스가 아니라 집계·식별자·해시·합성 픽스처만 포함한다.

---

### User Story 5 - ablation으로 기본 결합 방식을 고르고 대안은 기록만 한다 (Priority: P2)

검색 품질 담당자는 짧은 쿼리에 대해 "모든 단어 동시 요구" 대비 "합집합 + 접두 확장"을 같은 픽스처로 비교한 기록을 남긴다. 인덱스 전체를 다른 토큰 방식으로 재구축하는 대안은 비용이 커서 이번 기본 채택 조건이 아니며, 비교 메모만 남긴다.

**Why this priority**: 이슈가 ablation과 차선 대안 비교를 요구하지만, 재구축 대안은 출시 필수 조건이 아니다. 기본값 결정은 스토리 1–4의 증거로 충분하다.

**Independent Test**: ablation 표(후보 수·상위 관련성·회귀 여부)가 스펙 폴더 또는 이슈에 남아 있고, 재구축 대안은 "비교만 / 미채택 사유"가 한 줄이라도 있으면 통과다.

**Acceptance Scenarios**:

1. **Given** 동일 픽스처와 동일 쿼리 집합, **When** 짧은 쿼리 결합 후보를 비교하면, **Then** 후보 수와 상위 관련성·회귀 여부가 표로 기록된다.
2. **Given** 인덱스 재구축이 필요한 토큰 방식 대안, **When** 검토하면, **Then** 이번 범위에서 기본값으로 채택하지 않으며 사유가 기록된다.
3. **Given** 채택된 기본값, **When** 변경 범위를 보면, **Then** 랭킹 가중치 설정값 재튜닝은 포함되지 않는다.

---

### Edge Cases

- 토큰이 하나도 남지 않는 빈/기호만·불용어만 남은 질문: **기존 빈 질문 동작을 유지**한다(이 이슈에서 빈 질문 의미를 새로 정의하지 않음).
- 한 글자(또는 동등하게 과도하게 짧은) 어간에 접두 확장을 붙이면 후보가 폭증할 수 있다: **최소 어간 길이 미만이면 접두 확장을 적용하지 않고** 정확 토큰 매치만 쓴다(Q1).
- 매우 짧은 접두라도 허용 길이 이상이면: 후보 수 상한·기존 LIMIT 계약 안에서 동작하며, 상위 관련성은 스토리 3으로 판정한다.
- 질문에 따옴표·괄호·결합 키워드처럼 보이는 기호가 섞여 있어도: **사용자가 검색 연산자를 주입하지 못한다.** 기호는 내용어가 아니면 제거하고, 내용어만 결합 규칙에 넣는다(Q2).
- 긴 쿼리(기존 합집합 구간): **결합자(동시 요구 → 합집합) 변경은 짧은 구간에만** 적용한다. 긴 구간의 합집합 의미는 유지하되, 채택 시 **접두 확장은 짧은·긴 구간에 동일하게** 적용해 조사·활용 손실을 막는다(Q5).
- 텍스트 전용 검색(벡터 불가): 텍스트 후보가 0이던 짧은 다개념 쿼리가 교정 후 0이 아니어야 하며, 벡터 없이도 개선이 관측되어야 한다.
- 필터(타입·태그·소유자 등)가 있는 검색: 필터는 기존처럼 후보 제한에 적용되고, 결합자 변경만으로 필터를 우회하지 않는다.
- 후보 폭증(합집합·접두 후 수천 건): **기존 후보 상한·LIMIT 계약을 재사용**하며, 새 무제한 풀을 만들지 않는다(Q4).
- ablation에서 정밀도 하락이 순위 단계에 흡수되지 않으면: **전역 기본값을 바꾸지 않고** 현행 짧은 결합자를 유지하며, 표에 미채택 사유를 남긴다(Q3 / FR-006).
- #806이 아직 없으면: 텍스트 후보 수·합성 관련성으로 1차 검증은 가능하나, **벡터 점수 기반 정밀도 채택 판정은 #806 이후로 미룬다**(Q8).
- #808 한국어 gold set이 아직 없으면: 합성 다개념 픽스처와 영어 회귀로 출시 게이트를 세우고, gold Recall@10은 gold가 준비되는 즉시 추가 측정한다.
- 공개 MCP/검색 도구의 요청·응답 스키마는 바꾸지 않는다. 결과는 좋아지지만 계약 형태는 동일하다(Q9).
- recall·admin·injection·reflection 등 **공유 FTS 쿼리 빌더를 거치는 경로**는 동일 결합·접두 규칙을 쓴다. 경로별 다른 결합자를 두지 않는다(Q11).
- 숫자·영문·한글 등 문자 종류와 무관하게 **최소 어간 길이**만으로 접두 적용 여부를 가른다(Q13).
- 채택 후 문제가 드러나면 **코드 revert**로 되돌린다. 이 이슈 전용 kill-switch env는 추가하지 않는다(Q14).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 짧은 다개념 질문에서 텍스트 후보 수집은 "모든 단어를 한 문서에 동시 요구"에 의존해 0건이 되어서는 안 된다. 단어가 서로 다른 문서에만 있어도 합집합으로 후보가 생겨야 한다.
- **FR-002**: 짧은 질문의 텍스트 후보는 표면형(조사·활용) 차이로 같은 어간이 탈락하지 않도록, 접두 확장을 포함한 방식으로 매치할 수 있어야 한다(단 FR-014 최소 어간 길이 제약).
- **FR-003**: 긴 질문의 기존 텍스트 후보 의미(합집합 계열)는 회귀 없이 유지되어야 한다.
- **FR-004**: 채택 전 짧은 쿼리 결합 후보는 ablation으로 비교해야 하며, 비교 지표에 텍스트 후보 수와 상위 관련성이 포함되어야 한다.
- **FR-005**: ablation 해석에 벡터 점수를 쓸 때는 절대 척도(#806)가 전제여야 한다. 상대 재조정 점수로는 정밀도 판정을 하지 않는다.
- **FR-006**: 정밀도 하락이 순위 단계에서 흡수되지 않으면, 해당 결합 방식을 전역 기본값으로 채택해서는 안 된다.
- **FR-007**: 채택된 방식에서 짧은 다개념 쿼리의 텍스트 후보 수는 회귀 테스트로 0보다 큼이 고정되어야 한다.
- **FR-008**: 영어 세션 검색 벤치마크(또는 승인된 합성 대체)에서 허용 회귀 한도를 넘는 악화가 없어야 한다.
- **FR-009**: 랭킹 가중치 설정값은 이 이슈 범위에서 재튜닝하지 않는다.
- **FR-010**: 인덱스 전체를 다른 토큰 방식으로 재구축하는 대안은 이번 기본 채택 조건이 아니며, 비교 기록만으로 충분하다.
- **FR-011**: 검색 필터·LIMIT·하이브리드 결합의 기존 계약은 유지되어야 한다. 이번 변경은 짧은 쿼리 텍스트 후보 생성 방식에 한정한다.
- **FR-012**: #808 한국어 gold set이 준비되면 Recall@10을 측정·기록해야 한다. gold 부재 시에도 FR-007·FR-008로 출시 가능하되, gold 측정은 후속 필수 관측으로 남긴다.
- **FR-013**: 공개 저장소에는 재배포 불가 벤치마크 원본·파생 코퍼스를 커밋하지 않는다. 집계·식별자·해시·합성 픽스처만 허용한다.
- **FR-014**: 접두 확장은 **최소 어간 길이**를 만족하는 내용어에만 적용한다. 그보다 짧은 토큰은 정확 매치만 사용하여 후보 폭증을 막는다.
- **FR-015**: 사용자 질문의 구두점·따옴표·연산자처럼 보이는 기호는 검색 결합 연산자로 해석되지 않아야 한다. 내용어만 짧은/긴 결합 규칙에 들어간다.
- **FR-016**: 채택 시 접두 확장은 짧은 구간뿐 아니라 **긴 구간의 내용어에도** 적용한다. 짧은 구간에만 적용하는 “동시 요구 → 합집합” 결합자 변경과 범위를 구분한다.
- **FR-017**: 합집합·접두로 후보가 늘어도 **기존 텍스트 후보 상한·결과 LIMIT 계약**을 넘지 않는다. 새 무제한 후보 풀을 도입하지 않는다.
- **FR-018**: 공개 검색/MCP 도구의 요청·응답 스키마는 변경하지 않는다(동작 품질만 개선).
- **FR-019**: 텍스트 후보 수 등 기존 검색 품질 관측 신호는 교정 전후에도 동일 의미로 비교 가능해야 한다(회귀 테스트·ablation이 같은 지표를 씀).
- **FR-020**: 짧은/긴 결합·접두 규칙은 **공유 FTS 쿼리 빌더**를 통하는 모든 검색 경로에 동일하게 적용된다. transport·UI별로 다른 결합자를 두지 않는다.
- **FR-021**: ablation 비교표는 이 feature의 스펙 산출물(체크리스트 또는 `specs/660-807-fts-or-prefix/` 동등 산출물)과 이슈 요약에 남아, 제3자가 채택/미채택 사유를 재현·이해할 수 있어야 한다(SC-006).
- **FR-022**: “정밀도 흡수” 채택 판정은 **SC-002**(상위 관련성 비악화)와 **기존 영어 회귀 게이트**(FR-008/SC-004)로 하며, 이 이슈에서 새 ad-hoc 전역 임계(%)를 도입하지 않는다.

### Key Entities

- **짧은 다개념 질문**: 소수의 내용어가 서로 다른 개념을 가리키는 짧은 검색문. 한 문서에 모든 단어가 동시에 있을 가능성이 낮다.
- **텍스트 후보**: 전문 검색 채널이 순위 결합 전에 모은 기억 집합. 수가 0이면 텍스트 증거가 최종 순위에 기여하지 못한다.
- **접두 확장 매치**: 질문 어간으로 조사·활용이 붙은 저장 표기까지 포괄하는 텍스트 매치 방식. 최소 어간 길이 미만에는 적용하지 않는다.
- **Ablation 기록**: 동일 픽스처에서 결합 후보를 나란히 비교한 표(후보 수·상위 관련성·회귀).
- **절대 벡터 점수**: 결과셋 상대 재조정이 아닌, 쿼리–기억 의미 근접도 자체(#806).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 짧은 다개념 픽스처 쿼리 집합에서 텍스트 후보 수가 0인 비율이 0%이다(교정 전 관측된 실패 유형 제거).
- **SC-002**: 동일 픽스처에서 관련 기억이 최종 상위 10 안에 포함되는 비율이 교정 전보다 낮아지지 않는다.
- **SC-003**: 조사가 붙은 저장 표기 vs 어간 질문 픽스처에서, 대상 기억이 텍스트 후보에 포함되는 비율이 100%이다(최소 어간 길이를 충족하는 경우).
- **SC-004**: 영어 세션 검색 핵심 지표가 허용 회귀 한도 이내이다(한도는 기존 nightly/벤치 게이트와 동일하거나 명시적으로 기록).
- **SC-005**: 랭킹 가중치 설정값 diff가 이 작업 변경 집합에 0건이다.
- **SC-006**: ablation 표가 스펙 산출물 또는 이슈에 남아, 채택/미채택 사유를 제3자가 재현·이해할 수 있다.
- **SC-007**: #808 gold set이 존재하는 환경에서는 한국어 Recall@10이 교정 전 대비 개선되거나, 미개선 시 미채택 사유가 기록된다.
- **SC-008**: 공개 검색/MCP 도구 스키마 스냅샷 비교에서 이 작업으로 인한 breaking shape 변경이 0건이다.

## Assumptions

- "짧은 질문"의 토큰 수 경계는 현재 제품의 짧은/긴 구분과 동일하게 둔다. 경계를 재설계하는 것은 이번 범위가 아니다.
- 기본 채택 후보는 합집합 + 접두 확장이다. 실측에서 이 조합이 LIKE 진실값에 가장 가깝거나 그 이상이었다.
- #806(절대 벡터 점수)이 반영된 뒤에서야 정밀도 하락 흡수를 **채택 판정**한다. #806 미완료여도 텍스트 후보 수·합성 관련성 교정과 회귀 테스트는 진행할 수 있다(Q8).
- #808은 측정 수단이다. gold 부재가 스토리 1·2·4의 합성/영어 게이트를 막지는 않는다.
- 랭킹 가중치 재튜닝은 명시적 Non-Goal이다. 후보 생성 교정만으로 상위 관련성이 유지되어야 한다.
- 인덱스 재구축형 토큰 대안은 운영 비용·마이그레이션 때문에 차선이며, 이번 출시 차단 조건이 아니다.
- 최소 어간 길이의 구체 숫자는 계획 단계에서 현행 토큰 규칙·실측에 맞춰 정하되, 기본 권고는 **2글자 미만에는 접두 미적용**이다(Q1).
- 영어 회귀 한도는 새 ad-hoc 임계를 만들지 않고 **기존 nightly/벤치 게이트**를 재사용한다(Q7).
- Constitution: Test-First(I), 공개 계약 호환(II), 완료 전 lint/type-check/test(IV), 관측 가능 실패(V). 스키마 마이그레이션(III)은 본 이슈 기본 경로에 없음(재구축 대안은 비교만).
- Brainstorm (2026-08-29): Q1–Q10 Resolved — 사용자 “추천을 선택해줘”로 권고안 일괄 채택.
- Brainstorm pass 2 (2026-08-29): Q11–Q15 Resolved — 동일 추천 모드. 경로 단일화·ablation 산출물 위치·문자종류 무관 최소길이·kill-switch 비도입·정량 판정=기존 SC/게이트. `/speckit.plan` 가능.
- Brainstorm pass 3 (2026-08-29): coverage audit — 신규 Open Question 없음(포화). 수치·픽스처 경로는 `/speckit.plan`으로 이관.

## Dependencies

- Epic [#803](https://github.com/jee1/memento/issues/803) 하위. #785에서 남긴 "짧은 쿼리 암시적 AND" 미해결 항목의 실측 ablation이다.
- **선행(정밀도 채택 판정)**: [#806](https://github.com/jee1/memento/issues/806) — 벡터 점수 절대화. 없으면 OR 정밀도 판정이 왜곡된다. 텍스트 후보 교정 자체와는 병렬 가능.
- **측정**: [#808](https://github.com/jee1/memento/issues/808) — 한국어 gold Recall@10. 출시 하드 게이트는 아니나 SC-007에 연결된다.
- #787은 BM25 부호·정렬을 고치고 결합자는 동결했다. 이 이슈가 그 결합자 동결을 실측으로 해제·교체한다.

## Out of Scope

- 랭킹 가중치 설정값 재튜닝.
- 짧은/긴 토큰 수 경계 재설계.
- 인덱스 전체 재구축형 토크나이저로의 기본값 전환(비교 기록만).
- 공개 MCP/검색 도구 스키마 변경.
- 빈 질문 의미·match-all 정책의 재정의.
- 벡터 임계값·under-fill 상수 변경(#789 동결 유지).
- 이 이슈 전용 combinator kill-switch / feature-flag env 추가(채택 실패는 미채택·채택 후 문제는 revert).

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | 한 글자(과도하게 짧은) 어간에도 접두 확장을 적용할까? | Resolved | **최소 어간 길이 미만은 접두 미적용**(권고: 2글자 미만). 정확 매치만. FR-014. |
| Q2 | 사용자 입력의 따옴표·괄호·AND/OR처럼 보이는 기호를 연산자로 허용할까? | Resolved | **비허용.** 내용어만 결합; 기호는 제거/무해화. FR-015. |
| Q3 | ablation에서 정밀도 하락이 흡수되지 않으면? | Resolved | **기본값 미변경**(현행 짧은 결합자 유지) + 미채택 사유 기록. FR-006. |
| Q4 | 합집합·접두 후 후보가 폭증하면 새 풀 한도를 둘까? | Resolved | **기존 LIMIT·후보 상한만 재사용.** 무제한 풀 금지. FR-017. |
| Q5 | 접두 확장을 짧은 구간에만 둘까, 긴 구간에도 둘까? | Resolved | **결합자 변경은 짧은 구간만; 접두는 짧은·긴 모두.** FR-016. |
| Q6 | 빈/불용어만 남은 질문 동작을 이 이슈에서 바꿀까? | Resolved | **바꾸지 않음** — 기존 빈 질문 동작 유지(호환). |
| Q7 | 영어 회귀 허용 한도를 새로 정할까? | Resolved | **기존 nightly/벤치 게이트 재사용.** 새 ad-hoc 임계 없음. |
| Q8 | #806 없이 기본값 채택까지 갈 수 있나? | Resolved | **텍스트 후보·합성 게이트는 가능; 벡터 정밀도 채택 판정은 #806 이후.** |
| Q9 | MCP/검색 도구 스키마를 바꿀까? | Resolved | **변경 없음.** 품질만 개선. FR-018 / SC-008. |
| Q10 | 관측 지표를 새로 만들까? | Resolved | **기존 텍스트 후보 수 등 funnel 신호를 그대로 비교.** FR-019. |
| Q11 | recall·admin·injection 등 경로마다 다른 결합자를 둘까? | Resolved | **공유 FTS 빌더 경로에 동일 규칙.** 경로별 분기 금지. FR-020. |
| Q12 | ablation 표는 어디에 남길까? | Resolved | **feature 스펙 산출물 + 이슈 요약**(SC-006). FR-021. |
| Q13 | 숫자·영문·한글 혼합 어간의 접두 규칙을 다르게 둘까? | Resolved | **문자 종류 무관, 최소 어간 길이만.** 토큰화는 기존 preprocess 유지. |
| Q14 | 채택 후 즉시 끄는 feature-flag/kill-switch를 넣을까? | Resolved | **넣지 않음.** 미채택=기본값 유지; 채택 후 문제=revert. |
| Q15 | “정밀도 흡수”의 새 전역 % 임계를 정할까? | Resolved | **정하지 않음.** SC-002 + 기존 영어 게이트로 판정. FR-022. |

## Brainstorm Log

### 2026-08-29 — Initial Brainstorm Session

**Categories explored**: Boundary conditions, Error scenarios, Scale & performance, Security & privacy, User experience

**Mode**: User directed “추천을 선택해줘”; Q1–Q10 resolved with recommended options in one pass (no interactive round-trips).

**Key insights**:

1. **Prefix blast radius** — Extremely short stems must not get prefix expansion; otherwise candidate flood undoes ranking. Min-stem rule is a product rule, digits deferred to plan.
2. **Operator injection** — Query punctuation must never become combinators; preserves trust boundary and matches “content words only” mental model.
3. **Fail-closed default** — If ablation shows precision not absorbed, keep current short combinator; do not ship noisy OR as global default.
4. **Scale** — Reuse existing caps/LIMIT; no second candidate pool design in this issue.
5. **Short vs long** — Only short path changes from “all terms required” to union; prefix is morphology fix for all tokenized content words.
6. **Empty query** — Out of scope to redefine; Principle II compatibility.
7. **#806** — Gates *adoption judgment* on vector precision, not the ability to fix zero text candidates.
8. **Contracts** — No MCP schema change; measure with existing `text_candidate_count`-class signals.
9. **English gate** — Reuse nightly/bench thresholds; LoCoMo licensing constraints unchanged.
10. **Security/privacy** — No new auth surface; search remains existing tool path; FTS operator injection closed by FR-015.

**Open questions**: Q1–Q10 all Resolved.

### 2026-08-29 — Pass 2 (residual / ops & coverage)

**Categories explored**: Cross-path consistency, Ablation artifact placement, Script-agnostic prefix, Rollback posture, Adoption metrics (skipped re-asking Q1–Q10 categories)

**Mode**: Re-run with “추천을 선택해줘”; Q11–Q15 resolved with recommended options in one pass.

**Key insights**:

1. **Single builder** — Combinator/prefix changes must ride the shared FTS query builder so recall/admin/injection/reflection stay aligned (FR-020).
2. **Ablation home** — Table lives with the feature artifact + issue summary; satisfies SC-006 without a new docs surface (FR-021).
3. **Script-agnostic stem** — Min length only; no separate digit/Latin/Hangul prefix policies in this issue.
4. **No kill-switch env** — Fail-closed before ship; after ship, revert. Avoids config surface growth (Principle II).
5. **No new % gate** — “Precision absorbed” = SC-002 + existing English gates (FR-022); plan may name fixtures but not invent ad-hoc global thresholds.

**Open questions**: Q1–Q15 all Resolved. **Brainstorm closed. Spec ready for `/speckit.plan`.**

### 2026-08-29 — Pass 3 (coverage audit)

**Categories explored**: Full audit of prior categories (Boundary, Error, Scale, Security, UX, Cross-path, Artifact, Rollback, Adoption). No unexplored product-decision gaps found.

**Mode**: Re-run with “추천을 선택해줘”; recommendation = **do not invent further questions** (diminishing returns). Defer concrete numbers (min stem length final digit, fixture paths, ablation table filename) to `/speckit.plan`.

**Key insights**:

1. **Saturation** — Q1–Q15 + Out of Scope already bound ship/fail-closed/contracts/measurement; another FR layer would be HOW, not WHAT.
2. **Plan handoff** — Remaining work is implementation planning (where to change `buildFTSQuery`, exact min-stem constant, ablation artifact path), not more edge-case product policy.

**Open questions**: none new. **Brainstorm remains closed. Spec ready for `/speckit.plan`.**
