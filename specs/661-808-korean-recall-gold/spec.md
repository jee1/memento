# Feature Specification: 한국어 recall gold set 구축 및 #785 recall 재측정

**Feature Branch**: `feature/test-quality-recall-gold-set-785-recall`
**Spec Directory**: `specs/661-808-korean-recall-gold`
**Created**: 2026-08-30
**Status**: Ready for Planning (brainstorm saturated)
**Issue**: [#808](https://github.com/jee1/memento/issues/808)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: #785, #787, #804, #807, #767, #737
**Input**: User description: "https://github.com/jee1/memento/issues/808 — 한국어 recall gold set 구축 및 #785 recall 재측정"

## Problem Statement

#785 계열 수정(#787 FTS/BM25, #788 fusion, #789 vector, #807 OR+prefix 등)이 코드·회귀 테스트 기준으로는 완료됐지만, **수정 후 production 경로(`memento_prod`) Recall@10·MRR이 재측정되지 않았다**. 에픽이 닫힌 것처럼 보여도 격차가 얼마나 줄었는지는 알 수 없다.

| 경로 | Recall@10 | MRR |
|---|---:|---:|
| FTS baseline | 0.8823 | 0.7131 |
| `memento_prod` (수정 전) | 0.3810 | 0.2267 |
| `memento_prod` (수정 후) | **미측정** | **미측정** |

또한 LoCoMo·LongMemEval-S는 **영어 코퍼스**다. 한국어 조사 융합(`가중치` vs `가중치는`)처럼 #807이 겨냥한 이득은 영어 벤치에 잡히지 않는다. 현재 유일한 한국어 증거는 라이브 코퍼스 프로브이며, 이는 recall 지표가 아니다. 한국어 gold set과 벤치 하네스 연결이 없으면 한국어 검색 품질을 재현 가능하게 추적할 수 없다.

#804(triple semantic 격리)의 코퍼스 격리 효과도 전/후 수치가 없으면 성공 여부를 판정할 수 없다.

## Goals

- #785와 동일한 조건으로 `memento_prod` 1,536문항(비적대) scorecard를 재측정해 수정 후 baseline을 확정한다.
- 조사 융합·짧은 다개념 케이스를 포함한 **커밋 가능한 한국어 gold set**을 구축한다.
- 기존 품질 벤치 하네스에 한국어 arm을 연결해 Recall@10(및 동등 지표) baseline을 기록한다.
- #804 격리·#807 FTS 변경의 전/후 비교를 git SHA·ranking hash와 함께 재현 가능한 형태로 남긴다.

## Non-Goals

- 새 검색 알고리즘·랭킹 가중치 튜닝(측정만; 개선 구현은 후속 이슈)
- LoCoMo·LongMemEval 원본·파생 코퍼스 커밋
- 라이브 기억 원문·PII·비공개 프로젝트 내용을 저장소에 넣는 것
- 공식 LoCoMo QA 정답률(판정자 accuracy) 경로 확장
- #804 격리 실행 자체(격리는 #804 범위; 본 스펙은 **측정·기록**)
- CI에서 전체 LoCoMo 1,536 강제(로컬/야간·취득 코퍼스 전제; CI는 합성·소형)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 수정 후 production recall을 다시 잰다 (Priority: P1)

검색 품질 담당자는 #785 계열 수정이 반영된 현재 코드로, 과거와 같은 LoCoMo 1,536 non-adversarial 조건의 `memento_prod` Recall@10·MRR을 다시 잰다. 결과가 artifact에 남아 “수정 후 baseline”으로 인용 가능해야 한다.

**Why this priority**: 에픽 완료 체크가 회귀 테스트 통과만으로 채워져 실제 격차 축소 여부를 모른다. 한국어 gold보다 먼저 영어 production 경로의 현재 숫자를 고정해야 후속 비교의 기준선이 생긴다.

**Independent Test**: 취득된 LoCoMo가 있는 환경에서 production scorecard를 한 번 돌리면 Recall@10·MRR·reproduction(git SHA·ranking hash 등)이 artifact에 있고, 공개 문서/스펙에는 집계·ID·해시만 남으면 통과다.

**Acceptance Scenarios**:

1. **Given** `.local/locomo/`에 취득된 LoCoMo와 현재 트리, **When** #785와 동일 조건의 production scorecard를 실행하면, **Then** `memento_prod` Recall@10과 MRR이 artifact에 기록된다.
2. **Given** 해당 artifact, **When** reproduction 블록을 보면, **Then** clean git SHA, ranking version hash, dataset revision/hash, provider, eligible/excluded 요약이 포함된다.
3. **Given** 저장소와 공개 문서, **When** 결과를 남기면, **Then** LoCoMo 원본·파생 본문은 커밋되지 않고 집계·식별자·해시만 공개된다.
4. **Given** LoCoMo가 아직 없는 환경, **When** 이 스토리의 완료를 판정하면, **Then** “미취득으로 미측정”이 명시되며, 취득 후 재실행이 완료 조건으로 남는다(완료 선언은 측정 성공 후에만).

---

### User Story 2 - 한국어 gold set으로 recall을 잰다 (Priority: P1)

품질 담당자는 한국어 질문–정답(관련 기억 ID) 쌍으로 된 gold set을 사용해 Recall@10 baseline을 기록한다. gold set에는 조사 융합 케이스(`가중치` vs `가중치는`류)가 반드시 들어가고, 저장소에 커밋되는 내용은 합성·비PII만 허용된다.

**Why this priority**: 영어 벤치만으로는 #807 한국어 이득을 관측할 수 없다. gold 없이 라이브 프로브만 있으면 재현·회귀 게이트가 불가능하다.

**Independent Test**: 커밋된 합성 한국어 gold로 평가를 돌리면 Recall@10(및 정의된 동등 지표) baseline이 나오고, 조사 융합 카테고리 쿼리가 최소 1개 이상 포함·채점되면 통과다.

**Acceptance Scenarios**:

1. **Given** 커밋된 한국어 gold set, **When** 구성 요건을 검사하면, **Then** 질문–관련 ID 쌍이 있고 조사 융합 케이스가 포함되어 있다.
2. **Given** 동일 gold set, **When** production(또는 동등한 검색 품질) 경로로 평가하면, **Then** Recall@10 baseline이 artifact에 기록된다.
3. **Given** gold 작성에 라이브 코퍼스 샘플링을 사용한 경우, **When** 커밋 대상을 검토하면, **Then** 개인정보·비공개 프로젝트 원문은 제외되고 합성·익명화된 내용만 남는다.
4. **Given** 기존 search-quality 픽스처에 한국어 질의가 일부 있는 경우, **When** gold를 확장·정리하면, **Then** 중복·빈 정답·스키마 불일치가 정리되고 신규 케이스가 명확히 구분된다.

---

### User Story 3 - 기존 벤치 하네스에 한국어 arm을 연결한다 (Priority: P1)

평가 담당자는 새 프레임워크를 만들지 않고, 기존 agent-memory / search-quality 벤치 하네스에서 한국어 gold arm을 선택해 돌릴 수 있다. 영어 arm과 결과가 섞여 해석이 깨지지 않도록 arm·언어·카테고리가 artifact에 구분된다.

**Why this priority**: gold만 있고 하네스 연결이 없으면 매번 수동 스크립트가 되어 재현성과 야간/로컬 절차가 붕괴한다. 이슈가 “기존 벤치 하네스에 한국어 arm 연결”을 명시한다.

**Independent Test**: 문서화된 명령으로 한국어 arm만 실행하면 한국어 gold 기반 지표가 나오고, 영어 LoCoMo arm과 키가 분리되면 통과다.

**Acceptance Scenarios**:

1. **Given** 기존 품질 벤치 진입점, **When** 한국어 arm을 지정해 실행하면, **Then** 한국어 gold 기반 Recall@10(등)이 산출된다.
2. **Given** 동일 하네스, **When** 영어 LoCoMo(또는 합성 영어) arm을 실행하면, **Then** 기존 키가 유지되고 한국어 결과와 혼동되지 않는다.
3. **Given** CI, **When** 기본 게이트를 돌리면, **Then** 비재배포 코퍼스 없이도 합성 한국어 픽스처로 arm 존재·스키마·최소 케이스(조사 융합 포함)가 검증된다.

---

### User Story 4 - #804·#807 전후를 같은 척도로 비교한다 (Priority: P2)

품질 담당자는 코퍼스 격리(#804)와 FTS OR+prefix(#807) 전후를 **같은 gold/scorecard 척도**로 비교하고, 각 측정에 git SHA와 ranking hash를 붙여 나중에 재현한다.

**Why this priority**: 격리가 검색 상위를 얼마나 바꿨는지, prefix 도입이 한국어 recall을 얼마나 올렸는지가 수치 없이면 채택·롤백 근거가 없다. P1 측정 수단이 먼저 있어야 한다.

**Independent Test**: 최소 두 시점(또는 두 조건)의 artifact를 나란히 두면 동일 지표 열이 있고 각 행에 SHA·ranking hash가 있으면 통과다. 실제 격리 실행은 #804 소유이다.

**Acceptance Scenarios**:

1. **Given** #804 격리 전·후(또는 격리 적용/미적용 코퍼스)에서 동일 질의 세트, **When** 측정을 비교하면, **Then** Recall@10(또는 합의된 상위 적중 지표) 차이가 artifact에 기록된다.
2. **Given** #807 반영 전·후(또는 ablation on/off)와 한국어 gold, **When** 비교하면, **Then** 조사 융합·짧은 다개념 범주별 지표가 구분되어 기록된다.
3. **Given** 비교용 artifact 쌍, **When** reproduction을 보면, **Then** 각각에 git SHA와 ranking hash가 있어 재실행 시 동일 조건임을 확인할 수 있다.

---

### Edge Cases

- LoCoMo 미취득·손상·revision 불일치 시: 측정을 중단하고 사유를 보고하며, Recall@10·MRR 등 **가짜 수치를 채우지 않는다**.
- 불완전·중단된 LoCoMo 실행 artifact는 `failed`/`incomplete`로만 남기고 **수정 후 production baseline으로 승격하지 않는다**.
- Gold 스키마 불일치·빈 관련 ID 목록·필수 카테고리 누락: **채점 전에 실패**(부분 채점·degraded baseline 금지).
- 평가 시 관련 ID가 해석 불가하면 해당 질의는 **ineligible/skip으로 집계**하고 적중으로 세지 않는다. skip 후 필수 카테고리 유효 질의가 0이면 실행 실패다.
- 커밋 gold에 라이브 DB memory_id가 있으면 검증 실패다(합성 픽스처 ID만 허용).
- 조사 융합·짧은 다개념 케이스가 요구 미만인 gold: 구성 검증 실패로 취급한다.
- 라이브 샘플에서 PII·비공개 프로젝트 원문: 커밋 대상에서 제외; 레드액션 체크리스트를 문서화한다.
- arm 미지정 또는 영어+한국어를 기본으로 한 번에 돌려 단일 집계 키가 생기면 실패로 본다(언어 혼합 집계 금지).
- #804/#807 단측 스냅샷만 있을 때: 기록+TODO는 허용하되 전후 쌍이 없으면 US4/SC-004 미완료다.
- 알 수 없는/오타 필수 카테고리 태그 → 구성 검증 실패(동의어 허용 없음).
- opaque `queryId` 중복 → 채점 전 실패.
- 커밋 한국어 gold에 빈 `relevantIds`가 있으면 검증 실패(레거시 benchmark-v3 빈 항목은 한국어 gold 로드 집합 밖).
- LoCoMo 재측정 provider가 #785 비교 baseline과 불일치하면 reproduction에 불일치를 명시하거나 비교 행을 “비비교”로 표시(가짜 동등 비교 금지).
- 한국어 arm 결과가 영어 LoCoMo 또는 #731 category-report 수치 게이트와 합쳐지면 실패.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 #785와 동등한 조건(1,536 non-adversarial LoCoMo 질의, production `memento_prod` 경로)으로 현재 트리의 Recall@10·MRR을 측정하고 artifact에 기록해야 한다.
- **FR-002**: 모든 production/한국어 scorecard artifact는 clean git SHA, ranking version hash, dataset(또는 gold) revision/hash, embedding provider를 포함해야 한다.
- **FR-003**: 커밋 가능한 한국어 gold set이 존재해야 하며, 질문–관련 기억 ID 쌍과 **조사 융합**·**짧은 다개념** 필수 카테고리(FR-012 수량)를 포함해야 한다.
- **FR-004**: 커밋되는 gold·픽스처는 합성이어야 한다. 라이브 코퍼스에서 샘플링해 작성한 경우 개인정보·비공개 프로젝트 원문을 제거·합성 재작성한 뒤에만 반영해야 하며, 관련 ID는 인레포 합성 픽스처만 가리켜야 한다(FR-015).
- **FR-005**: 기존 품질 벤치 하네스에 한국어 arm을 연결해야 하며, 영어 arm과 결과 키·집계가 분리되어야 한다. arm은 명시적으로 선택되어야 한다(FR-019).
- **FR-006**: 한국어 arm 실행 결과는 **Recall@10과 MRR**을 artifact에 남겨야 한다. nDCG는 #808 성공 조건이 아니다.
- **FR-007**: #804 격리 전/후 비교가 가능하도록 동일 질의 세트·동일 지표 스키마로 측정 결과를 나란히 기록할 수 있어야 한다.
- **FR-008**: #807 전/후(또는 on/off ablation) 비교가 한국어 gold에서 가능해야 하며, `particle_agglutination`·`short_multi_concept` 범주가 구분되어야 한다.
- **FR-009**: LoCoMo 원본·파생 데이터와 라이브 원문은 저장소에 커밋하지 않아야 한다. 공개 문서에는 집계·식별자·해시만 허용한다.
- **FR-010**: CI는 비재배포 코퍼스 없이 합성 한국어 gold의 arm 스키마·필수 카테고리 존재·하네스 연결을 검증할 수 있어야 한다.
- **FR-011**: 기존 search-quality / agent-memory 합성 픽스처·게이트를 완화하거나 영어 회귀 기준을 낮추지 않아야 한다.
- **FR-012**: 커밋된 한국어 gold는 합성 질의 **최소 15개**를 포함해야 하며, 그중 **조사 융합 ≥1** 및 **짧은 다개념 ≥1**이 카테고리 태그로 식별 가능해야 한다.
- **FR-013**: gold 로드/검증은 스키마 불일치·빈 관련 ID 목록·필수 카테고리 누락 시 **채점 전에 실패**해야 하며, 부분 채점으로 baseline을 만들지 않아야 한다.
- **FR-014**: 평가 시 관련 ID가 해석 불가하면 해당 질의는 **ineligible/skip으로 집계**해야 하고 적중으로 세지 않아야 한다. skip 결과 필수 카테고리 유효 질의가 0이면 실행은 실패해야 한다.
- **FR-015**: 커밋된 gold의 관련 기억 ID는 **저장소 내 합성 픽스처 메모리**만 가리켜야 하며, 라이브 DB ID를 포함하지 않아야 한다.
- **FR-016**: LoCoMo 미취득·손상·revision 불일치 시 시스템은 측정을 중단하고 사유를 보고해야 하며, Recall@10·MRR 등 **가짜 수치를 기록하지 않아야** 한다.
- **FR-017**: CI는 LoCoMo 1,536 전체 scorecard를 요구하지 않아야 한다. CI는 합성 한국어 arm의 연결·스키마·필수 카테고리(및 허용된 초소형 smoke)만 강제해야 한다.
- **FR-018**: 불완전·중단된 LoCoMo 실행 결과는 **수정 후 production baseline으로 채택·게시되지 않아야** 한다.
- **FR-019**: 운영 문서·실행 출력은 measure-only 기록과 CI gate 검증을 **구분 라벨링**해야 하며, arm 미지정 시 언어 혼합 없이 **명시적 오류**를 내야 한다.
- **FR-020**: #804/#807 단측 스냅샷 기록은 허용해야 하나, 동일 지표 스키마의 **전후 쌍과 각 SHA·ranking hash**가 갖춰지기 전에는 US4/SC-004를 완료로 간주하지 않아야 한다.
- **FR-021**: 커밋 한국어 gold의 필수 카테고리 태그는 닫힌 어휘 `particle_agglutination`, `short_multi_concept`만으로 식별되어야 하며, #804 재사용 질의는 `triple_isolation_probe`로 태깅 가능해야 한다. 한 질의에 다중 태그 허용. 알 수 없는 태그는 구성 검증 실패다.
- **FR-022**: 한국어 arm scorecard는 **Recall@10과 MRR**을 artifact에 기록해야 한다. nDCG는 #808 성공 조건이 아니다.
- **FR-023**: LoCoMo 1,536 재측정은 취득 환경에서의 문서화된 로컬/수동(또는 기존 야간) 절차로 충족 가능해야 하며, **본 이슈는 신규 nightly 워크플로를 요구하지 않는다**.
- **FR-024**: 한국어 arm 결과는 measure-only로 라벨링되어야 하며, #731 등 **MRR 수치 quality gate / REQUIRED_MACRO 편입을 본 이슈에서 하지 않아야** 한다.
- **FR-025**: 라이브 샘플→합성 재작성 시 레드액션은 **문서 체크리스트+사람 검토**로 충분해야 하며, 자동 PII 스캐너 게이트는 요구하지 않는다(라이브 ID 금지는 FR-015 유지).
- **FR-026**: 커밋 한국어 gold의 각 질의는 **opaque `queryId`와 별도 query 본문**을 가져야 한다. query 본문을 `queryId`로 쓰지 않는다. `queryId` 중복은 채점 전 실패다.
- **FR-027**: 한국어 평가는 기존 품질 벤치 하네스·gold 계열의 **arm 확장**으로 제공되어야 하며, 별도 평가 프레임워크를 도입하지 않아야 한다.
- **FR-028**: 커밋 한국어 gold는 **빈 `relevantIds`를 포함하지 않아야** 한다.
- **FR-029**: 모든 scorecard artifact는 실제 사용한 embedding provider를 기록해야 한다. LoCoMo `memento_prod` 재측정은 #785와 비교 가능한 provider 조건을 문서·reproduction에 명시해야 한다(한국어 arm 단일 provider 강제는 없음).

### Key Entities

- **PostFixProductionScorecard**: #785 수정 후 LoCoMo `memento_prod` Recall@10·MRR과 reproduction 메타데이터
- **KoreanRecallGoldSet**: 합성 한국어 질문–관련 ID 집합(닫힌 카테고리 태그·opaque queryId 포함)
- **KoreanBenchArm**: 기존 하네스 안의 한국어 평가 경로(영어 arm과 키 분리, measure-only)
- **BeforeAfterComparison**: #804/#807 조건 쌍의 동일 지표 비교 기록(SHA·ranking hash 포함)
- **Category tags**: `particle_agglutination` | `short_multi_concept` | (선택) `triple_isolation_probe`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 취득 LoCoMo 환경에서 현재 트리 `memento_prod` Recall@10·MRR이 artifact에 한 번 이상 기록된다(미취득이면 완료 불가).
- **SC-002**: 커밋된 한국어 gold로 Recall@10·MRR baseline이 artifact에 기록된다.
- **SC-003**: 한국어 gold에 `particle_agglutination` 케이스가 포함되며, 구성 검증이 그 존재를 강제한다.
- **SC-004**: #804·#807 전후(또는 동등 조건 쌍) 비교가 동일 지표 스키마와 git SHA·ranking hash를 동반한 형태로 재현 가능하다.
- **SC-005**: CI에서 합성 한국어 arm 연결·스키마·필수 카테고리 검사가 통과하고, 영어 기존 게이트가 회귀하지 않는다.
- **SC-006**: 공개 산출물에 LoCoMo/라이브 원문이 없고 집계·ID·해시만 남는다.
- **SC-007**: 커밋된 한국어 gold가 ≥15 질의이며 조사 융합·짧은 다개념 각 ≥1을 구성 검증이 강제·통과한다(수치 quality gate가 아님).
- **SC-008**: 한국어 arm artifact에 Recall@10과 MRR이 함께 기록된다(수치 통과 임계값 없음).
- **SC-009**: 커밋 한국어 gold 검증이 닫힌 카테고리 태그·opaque queryId·비어 있지 않은 relevantIds·≥15/필수 카테고리 규칙을 강제하고 통과한다.

## Assumptions

- LoCoMo 전체 scorecard는 로컬(또는 야간)에서 취득 후 실행한다. CI는 합성 픽스처·arm 스키마만 강제하며 1,536을 돌리지 않는다. **신규 nightly 워크플로는 #808 비요구**.
- “#785와 동일 조건”은 기존 문서화된 production scorecard 절차(비적대 1,536, session-level evidence, `memento_prod`)를 의미한다. SC-001은 eligible 집합의 **완전 측정**일 때만 충족한다. provider는 #785 비교 가능 조건으로 reproduction에 명시한다.
- 한국어 gold는 합성 ≥15(`particle_agglutination`≥1, `short_multi_concept`≥1)이며 CI와 로컬이 **동일 커밋 세트**를 쓴다. 기존 search-quality 계열을 **확장**한다(새 프레임워크 금지). opaque `queryId` + 별도 query 본문; 빈 `relevantIds` 금지.
- 커밋 gold의 관련 ID는 인레포 합성 픽스처로 자기완결한다. 라이브 샘플은 작성 참고용이며 원문·라이브 ID는 커밋하지 않는다. 레드액션은 체크리스트+사람 검토만.
- #804 격리 실행 자체는 본 이슈 범위 밖이다. US4 비교는 **고정 한국어 gold** 우선(기존 #804 검증 10질의는 `triple_isolation_probe` 태그/부분집합으로 재사용 가능). LoCoMo 전후는 선택이다.
- #807이 이미 기본값으로 반영된 트리에서는 “전” 측정을 과거 SHA checkout 또는 ablation off로 확보한다.
- Recall@10/MRR **수치 통과 조건(예: ≥0.80)은 본 이슈에 두지 않는다**. 한국어 arm을 #731류 quality gate에 편입하지 않는다.
- 토큰 예산·latency·nDCG는 참고 필드로 남겨도 되지만, 본 이슈의 성공 판정은 Recall@10·MRR 기록·재현 메타데이터에 둔다.
- Brainstorm Pass 1 (2026-08-30): Q1–Q11 Resolved — 추천안 일괄 채택.
- Brainstorm Pass 2 (2026-08-30): Q12–Q19 Resolved — 동일 추천 모드. 태그 어휘·R@10+MRR·야간 비요구·체크리스트 레드액션·opaque id·하네스 확장·빈 GT 금지·provider 핀.
- Brainstorm Pass 3 (2026-08-30): coverage audit — 신규 Open Question 없음(포화). `/speckit.plan` 가능.

## Out of Scope

- 랭킹 가중치·새 임베딩 provider 도입으로 점수를 올리는 작업
- 이번 이슈의 Recall@10/MRR **하드·소프트 quality gate**(목표치 미달로 #808 실패 처리)
- 한국어 arm을 #731 MRR≥0.5 / REQUIRED_MACRO quality gate에 편입
- nDCG를 한국어 arm 성공 조건으로 강제
- CI에서 LoCoMo 1,536 강제 실행
- 신규 LoCoMo nightly workflow 신설을 #808 완료 조건으로 둠
- #804 전후를 LoCoMo 전체로 **필수** 비교하는 것(선택 관측만)
- 라이브 원문·익명화 라이브 텍스트·라이브 DB ID를 커밋 gold에 포함
- 커밋 전 자동 PII/원문 스캐너 제품화
- benchmark-v3 전량 opaque-id 마이그레이션 및 기존 빈 relevantIds 일괄 정리
- 한국어 전용 신규 평가 프레임워크
- 한국어 측정용 embedding provider 단일 고정(tfidf-only 등)
- LongMemEval 판정자 accuracy를 한국어로 확장
- 라이브 DB 일괄 익명화 파이프라인 제품화
- Epic #803의 다른 자식 이슈 구현

## Dependencies

- #767 / constitution: LoCoMo CC BY-NC — 원본·파생 비커밋
- #737 / #061-785: production scorecard·reproduction 필드 계약
- #804: 격리 전후 코퍼스 상태(측정 대상)
- #807: OR+prefix(한국어 이득 가설); gold 측정이 #807 채택 관측을 완성

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | 한국어 gold 최소 질의 수는? | Resolved | 조사 융합≥1 + 짧은 다개념≥1 포함 **≥15** 합성 질의(CI·로컬 동일 세트). FR-012 / SC-007. |
| Q2 | #804 전후 비교 질의 세트는 LoCoMo인가 한국어 gold인가? | Resolved | **고정 한국어 gold** 우선(기존 #804 10질의 태그/부분집합 재사용 가능). LoCoMo 전후는 선택·US4 비필수. |
| Q3 | 수정 후 LoCoMo 목표치를 이번 이슈 통과 조건으로 넣는가? | Resolved | **넣지 않음**. 측정·기록만; 목표 미달은 후속 이슈. |
| Q4 | 관련 ID 미해석 시? | Resolved | ineligible/skip 집계·비적중; 필수 카테고리 유효 0이면 실패. FR-014. |
| Q5 | 불량 gold 스키마는? | Resolved | 채점 전 fail-closed. FR-013. |
| Q6 | LoCoMo 미취득·손상·revision 불일치? | Resolved | abort·가짜 수치 금지. FR-016. |
| Q7 | CI vs 로컬 범위? | Resolved | CI=합성 arm/스키마/카테고리만; 1536은 로컬/야간. FR-017. |
| Q8 | 불완전 LoCoMo 실행을 baseline으로? | Resolved | 승격 금지. FR-018. |
| Q9 | 라이브 샘플 커밋 경계? | Resolved | 합성 재작성+인레포 픽스처 ID만; 라이브 원문/ID 금지. FR-015. |
| Q10 | measure-only vs gate·arm UX? | Resolved | 구분 라벨; arm 미지정=에러; 혼합 집계 금지. FR-019. |
| Q11 | 단측 스냅샷만으로 US4 완료? | Resolved | 전후 쌍 없으면 미완료. FR-020. |
| Q12 | 카테고리 태그 어휘? | Resolved | 닫힌 어휘 `particle_agglutination` / `short_multi_concept` / (선택) `triple_isolation_probe`; 다중 태그 허용. FR-021. |
| Q13 | 한국어 arm MRR·nDCG? | Resolved | Recall@10+MRR 필수; nDCG 비필수. FR-022 / SC-008. |
| Q14 | 1536 소유권·야간·게이트? | Resolved | 문서+수동/로컬로 충분(신규 nightly 비요구); 한국어 arm은 #731류 수치 게이트 비편입. FR-023–024. |
| Q15 | 레드액션 자동화 깊이? | Resolved | 체크리스트+사람 검토만. FR-025. |
| Q16 | queryId 계약? | Resolved | opaque id + 별도 query 본문; v3 text-as-id 강제 이전 없음. FR-026. |
| Q17 | gold/하네스 WHAT 선호? | Resolved | 기존 품질 벤치·gold 계열 확장; 새 프레임워크 금지. FR-027. |
| Q18 | 빈 relevantIds? | Resolved | 커밋 한국어 gold에서 금지. FR-028. |
| Q19 | provider 정책? | Resolved | artifact 핀; LoCoMo는 #785 비교 가능 조건; 한국어 단일 강제 없음. FR-029. |

## Brainstorm Log

### Pass 1 — 2026-08-30 (추천안 일괄 채택)

1. **측정-only** — Recall@10≥0.80 등 quality gate 명시적 배제(Q3).
2. **Gold 바닥** — ≥15 + 조사 융합≥1 + 짧은 다개념≥1(Q1→FR-012/SC-007).
3. **#804 비교** — 고정 한국어 gold; LoCoMo 전후는 선택(Q2).
4. **Fail-closed** — 불량 gold 채점 전 거부; LoCoMo 문제 시 가짜 수치 금지(Q5–Q6).
5. **Skip 규칙** — 미해석 ID는 skip+집계, 필수 카테고리 고갈 시 실패(Q4).
6. **CI 범위** — 스키마/arm/카테고리만; 1536·수치 게이트 금지; 부분 1536 baseline 승격 금지(Q7–Q8).
7. **커밋 경계** — 합성 재작성 + 인레포 픽스처 ID만(Q9/FR-015).
8. **UX** — measure-only vs gate 라벨, arm 미지정 에러, 단측≠US4 완료(Q10–Q11).

### Pass 2 — 2026-08-30 (coverage audit, 추천안 일괄 채택)

1. **태그 어휘** — `particle_agglutination` / `short_multi_concept` / 선택 `triple_isolation_probe`(Q12→FR-021).
2. **지표** — 한국어 arm Recall@10+MRR; nDCG 비필수(Q13→FR-022/SC-008).
3. **소유권** — 1536은 문서+수동/로컬; 신규 nightly·#731 편입 금지(Q14→FR-023–024).
4. **레드액션** — 체크리스트+사람 검토만; 자동 스캐너 OoS(Q15→FR-025).
5. **queryId** — opaque id + 별도 본문; v3 text-as-id 강제 이전 없음(Q16→FR-026).
6. **WHAT** — 기존 하네스·gold 확장; 새 프레임워크 금지(Q17→FR-027).
7. **빈 GT** — 커밋 한국어 gold에서 빈 relevantIds 금지(Q18→FR-028).
8. **provider** — artifact 핀; LoCoMo는 #785 비교 가능; 한국어 단일 강제 없음(Q19→FR-029).

### Pass 3 — 2026-08-30 (saturation audit)

1. 5카테고리 WHAT 재감사 — 신규 Open Question 없음.
2. 잔여는 plan HOW(하네스 연결·픽스처 작성·재측정 절차).
3. **READY_FOR_PLAN: yes**.