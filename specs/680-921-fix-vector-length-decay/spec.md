# Feature Specification: 짧은 기계 생성 문장이 관련 질의에서도 정답을 밀어낸다

**Feature Branch**: `feature/fix-search` (worktree 재사용)
**Spec Directory**: `specs/680-921-fix-vector-length-decay`
**Created**: 2026-09-07
**Status**: Executed — review PASS (SC-003 residual)
**Issue**: [#921](https://github.com/jee1/memento/issues/921)
**Input**: 답이 DB에 있는 정상 질의에서 짧은 기계 생성 문장이 긴 정답보다 높은 벡터 점수를 받아 순위를 밀어낸다. 생성 시 길이 하드 게이트는 이미 실패(#903). 벡터 점수에 길이에 따른 부드러운 감쇠를 적용한다.

## Problem Statement

관련 질의에서도 짧은(대략 20자대) extract_triples 유래 문장이 긴 정답 기억보다
높은 벡터 유사도를 받아 top-k에서 정답을 밀어낸다.

재현 질의: `우리말 질의가 엉뚱한 결과를 내던 원인을 찾아 고친 기록`

관측(이슈 보고):
- 0.749 — 21자 트리플 문장
- 0.734 — 22자 트리플 문장
- 0.722 — 663자 실제 정답

라이브 DB 실측(#903): 20자 미만 문서는 200–600자 문서보다 무관 질의 평균
코사인 유사도가 약 5배 높다. 중심(centroid) hubness가 원인이 아니며 centering은
악화시킨다. 생성 시점 40자 하드 게이트는 정상 짧은 사실(14–22자)까지 막아
파이프라인 테스트 60건이 깨져 되돌렸다.

## Goals

- 관련 질의에서 긴 정답이 짧은 기계 생성 문장보다 위에 오도록 벡터 점수를
  길이에 따라 **부드럽게** 감쇠한다.
- 감쇠 계수는 설정으로 조정 가능하다.
- 계수 선택은 눈대중이 아니라 **#920에서 복구한 nightly quality gate**의
  before/after로 검증한다(긴 문서 위주 질의 품질 악화 여부 포함).
- 정상적으로 짧은 사실 기억은 계속 생성·저장된다(생성 경로 하드 게이트 없음).

## Non-Goals

- 기억 생성/인제스트 시 최소 길이 하드 게이트(#903에서 시도·되돌림).
- 무관 질의를 임계값만으로 걸러내는 #903 목표(별개·달성 불가 판정).
- 임베딩 모델 교체(#889는 관련성 순서는 고쳤으나 본 결함은 남음).
- Centering / hubness 교정(실측상 악화).
- MCP/Admin 계약 변경, 스키마 마이그레이션.
- 텍스트(FTS) 채널 점수에 동일 감쇠 강제(본 이슈는 벡터 채널).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 관련 질의에서 긴 정답이 짧은 문장 위에 온다 (Priority: P1)

에이전트가 정상 관련 질의를 내면, DB에 있는 긴 정답 기억이 짧은 기계 생성
문장보다 위에 랭크된다.

**Why this priority**: 이슈의 핵심 증상. top-k 호출자 관점 버그.

**Independent Test**: 이슈 재현 질의(또는 동등 fixture)에서 663자급 정답이
21·22자급 트리플 문장보다 높은 최종(또는 벡터) 순위를 갖는다.

**Acceptance Scenarios**:

1. **Given** 짧은 트리플 문장 2건과 긴 정답 1건이 후보에 있고 질의가 정답과
   관련된다, **When** hybrid/vector 검색, **Then** 긴 정답이 두 짧은 문장보다
   위에 온다.
2. **Given** 동일 원시 벡터 유사도라도 문서 길이가 크게 다르다, **When** 감쇠
   적용, **Then** 짧은 쪽 유효 벡터 점수가 긴 쪽보다 낮아진다(단조·연속).

---

### User Story 2 - 정상 짧은 사실은 계속 저장·검색된다 (Priority: P1)

`사용자는 커피를 선호합니다` 같은 짧은 사실이 생성 단계에서 거절되지 않으며,
관련 질의에서는 여전히 검색 가능하다.

**Why this priority**: #903 하드 게이트 회귀 방지. 지식을 버려 아티팩트를
우회하지 않는다.

**Independent Test**: 생성/CRUD 경로에 길이 하한 게이트가 없고, 짧은 사실
픽스처 관련 테스트가 통과한다.

**Acceptance Scenarios**:

1. **Given** 14–25자 정상 사실 콘텐츠, **When** semantic/remember 생성,
   **Then** 길이만으로 거절되지 않는다.
2. **Given** 짧은 사실과 정확히 맞는 질의, **When** 검색, **Then** 해당 사실이
   결과에 나타날 수 있다(완전 소멸 금지).

---

### User Story 3 - 감쇠는 설정으로 조정·품질 게이트로 검증한다 (Priority: P2)

운영자가 감쇠 세기/특성 길이를 설정으로 바꿀 수 있고, 변경은 nightly quality
before/after로 긴 문서 위주 질의 품질을 해치지 않음을 확인한다.

**Why this priority**: 이슈 완료 기준. 계수 눈대중 금지.

**Independent Test**: 설정 키로 감쇠 on/off 또는 세기 변경 가능; quality
harness before/after 수치 기록.

**Acceptance Scenarios**:

1. **Given** 기본 감쇠 설정, **When** nightly(#920 복구 게이트) 실행,
   **Then** before 대비 after가 문서화되고 긴 문서 위주 질의 지표가 허용
   범위 밖으로 악화되지 않는다.
2. **Given** 감쇠 계수 설정 변경, **When** 프로세스 재기동 후 검색,
   **Then** 동일 후보의 유효 벡터 점수(또는 순위)가 설정에 따라 달라진다.

### Edge Cases

- 길이 0 / 매우 짧은(≤10자): 강한 감쇠. (데이터상 트리플 오염과 무관한
  구간이어도 함수는 연속이어야 함.)
- 정상 짧은 사실(14–25자): 생성 허용; 검색에서는 감쇠되나 완전 차단 금지.
- 긴 문서(≥200자): 감쇠 인자가 1에 가깝게 수렴(사실상 미감쇠).
- 벡터 점수만 감쇠; 텍스트 전용 후보는 본 감쇠 대상 아님.
- 임계값(`HYBRID_VECTOR_THRESHOLD`)과의 상호작용: 감쇠 후 점수로
  threshold/under-fill을 통과해야 함(원시 유사도로만 통과시키면 순위 왜곡
  남음).
- ranking version 해시에 감쇠 파라미터가 포함되어 before/after 관측이
  구분 가능해야 함.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hybrid/vector 검색 경로에서 후보의 **벡터 유사도 점수**에 문서
  길이 기반 **연속·단조 증가** 감쇠 인자를 곱해 유효 점수를 산출해야 한다
  (계단/하드 컷오프 금지).
- **FR-002**: 감쇠는 **검색 랭킹/퓨전 전** 벡터 채널에만 적용한다. 기억
  생성·저장 경로에 최소 길이 하드 게이트를 두지 않는다.
- **FR-003**: 감쇠 세기·특성 길이(또는 동등 파라미터)는 설정으로 노출되어
  재기동 후 조정 가능해야 한다. 기본값은 quality before/after로 선택한
  값이어야 한다.
- **FR-004**: 이슈 재현 시나리오(짧은 트리플 vs 긴 정답, 관련 질의)에서 긴
  정답이 짧은 문장보다 위에 와야 한다.
- **FR-005**: 짧은 정상 사실의 생성·관련 검색이 길이만으로 막히지 않아야
  한다(기존 파이프라인 단언 회귀 금지).
- **FR-006**: 계수 선택은 #920에서 복구한 nightly quality gate의
  before/after로 검증하고, 긴 문서 위주 질의 품질이 허용 범위 밖으로
  악화되지 않아야 한다.
- **FR-007**: 랭킹 버전(관측/텔레메트리)에 감쇠 파라미터가 포함되어 설정
  변경이 버전으로 구분되어야 한다.
- **FR-008**: 단위/도메인 회귀 테스트가 짧은 vs 긴 후보 순위 역전 교정과
  감쇠 단조성(길이↑ → 인자↑)을 고정해야 한다.

### Key Entities

- **Search candidate**: 기억 본문 길이(문자 수)와 원시 벡터 유사도를 가진
  검색 후보.
- **Length decay factor**: 길이 → (0, 1] 연속 단조 함수 값.
- **Effective vector score**: 원시 유사도 × 감쇠 인자(threshold·fusion·최종
  관련성 입력).

### Assumptions

- 본문 길이는 저장 content 문자열 길이(UTF-16 code unit / JS `.length`)로
  측정한다(기존 이슈 표와 동일 척도).
- #920 nightly quality harness가 이 worktree에서 실행 가능하다.
- 텍스트(FTS) 전용 후보는 본 감쇠 밖; hybrid fusion의 벡터 항만 영향.
- 기본 감쇠를 “끔”으로 두지 않는다(버그 수정이 기본 on). 실험용 끄기는
  계수 극단값 또는 명시 플래그로 가능하면 충분.

## Success Criteria *(mandatory)*

- **SC-001**: 재현 질의(또는 동등 fixture)에서 긴 정답이 21·22자급 짧은
  문장보다 위에 온다.
- **SC-002**: 생성 경로에 길이 하드 게이트가 없으며, 짧은 사실 관련 기존
  테스트가 통과한다.
- **SC-003**: nightly quality before/after가 기록되고, 긴 문서 위주 질의
  지표가 합의 허용 범위 밖으로 악화되지 않는다.
- **SC-004**: 감쇠 파라미터가 설정으로 변경 가능하고 ranking version에
  반영된다.
- **SC-005**: 검색 도메인 회귀·type-check가 통과한다.

## Brainstorm Log

| Date | Session | Insights |
|------|---------|----------|
| 2026-09-07 | 1 | Q1–Q5 auto-select recommended (canonical). Soft continuous decay on vector channel only; no create-time gate; coefficients via ranking config + nightly #920 before/after; apply effective score before threshold/fusion; ranking version includes params. |

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | 감쇠 적용 채널? | Resolved | A — 벡터 유사도만 (텍스트/FTS 채널 미적용). |
| Q2 | 함수 형태? | Resolved | A — 연속 단조(예: `len/(len+k)` 계열). 계단·하드 컷오프 금지. |
| Q3 | 적용 시점? | Resolved | B — 원시→유효 변환 후 threshold·under-fill·fusion이 유효 점수를 사용. |
| Q4 | 계수 선정? | Resolved | A — #920 nightly quality before/after. 눈대중 금지. |
| Q5 | 생성 경로 길이 게이트? | Resolved | A — Non-Goal. 금지(#903 회귀). |
| Q6 | 추가 brainstorm? | Resolved | A — 불필요. plan으로 진행. |
