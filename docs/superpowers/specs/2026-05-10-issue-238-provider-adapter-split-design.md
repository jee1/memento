# 설계: 이슈 #238 — 실제 LLM provider adapter 연결 분해

**상위:** [GitHub #238](https://github.com/jee1/memento/issues/238)  
**부모 기능:** [GitHub #82](https://github.com/jee1/memento/issues/82)  
**관련 구현 이슈:** [#231](https://github.com/jee1/memento/issues/231) ~ [#237](https://github.com/jee1/memento/issues/237)

**하위 실행 이슈(실제 provider 연결):**

| 순서 | 이슈 | 제목(요약) |
| ---: | --- | --- |
| 1 | [#334](https://github.com/jee1/memento/issues/334) | provider runtime contract + config gating |
| 2 | [#335](https://github.com/jee1/memento/issues/335) | OpenAI provider adapter 연결 |
| 3 | [#336](https://github.com/jee1/memento/issues/336) | Gemini provider adapter 연결 |
| 4 | [#337](https://github.com/jee1/memento/issues/337) | Ollama provider adapter + local smoke/docs |

**문서 개정 이력:** 2026-05-15 — `#238` GitHub 본문의 하위 이슈 번호·완료 기준·용어를 본 설계에 반영(추적성 보강). 설계 결정(분해 구조·권장 순서)은 변경 없음.

## 1. 문제

`#238`은 현재 다음 책임을 한 이슈에 함께 담고 있다.

- 실제 provider 활성화 조건과 공통 런타임 계약
- OpenAI/Gemini/Ollama adapter 구현
- API 키, timeout, fallback, 비용 가드 설계
- provider 실패 시 오류 표면
- 문서화와 smoke 검증

이 조합은 1~2일 PR 단위를 넘기기 쉽고, provider별 SDK 차이와 로컬 런타임 차이 때문에 회귀 범위도 커진다.

## 2. 목표

- `#238`을 umbrella 이슈로 재정의한다.
- 실행 단위는 `PR 1개로 1~2일 내 검증 가능한 크기`로 유지한다.
- 공통 런타임 경계와 provider별 구현을 분리해 병렬 작업과 검증을 쉽게 만든다.
- 기존 mock provider 기반 테스트 경로는 유지한다.

## 3. 결정

`#231`~`#237`은 유지하고, `#238`만 하위 실행 이슈로 분해한다.

이유는 다음과 같다.

- `#231`~`#237`은 이미 계약, context 구성, mock provider, 후보 추출, persistence, CLI, E2E/docs로 책임이 분리돼 있다.
- `#236`, `#237`은 경계선이지만 아직 단일 PR로 닫을 수 있는 크기다.
- `#238`만 공통 인프라, provider별 구현, 운영 문서가 함께 묶여 있어 명확히 과대하다.

## 4. 새 구조

### `#238` umbrella

제목은 유지하되 본문을 “실제 provider 연결 작업의 상위 추적 이슈”로 바꾼다.

포함 범위:

- 공통 런타임 경계
- OpenAI adapter 연결
- Gemini adapter 연결
- Ollama adapter 연결 및 로컬 smoke/docs

직접 구현 항목:

- 없음. 실제 코드는 모두 하위 이슈([#334](https://github.com/jee1/memento/issues/334)~[#337](https://github.com/jee1/memento/issues/337))에서 처리한다.

### [#334](https://github.com/jee1/memento/issues/334) — provider runtime contract + config gating

공통 런타임 경계를 먼저 고정하는 이슈다.

포함:

- provider enabled/disabled 판단
- env/config 해석 규칙
- timeout 기본값과 공통 옵션 shape
- 사용자 친화적 오류 모델
- mock provider 경로와 실제 provider 경로의 분기 규칙

제외:

- 특정 provider SDK 호출
- provider별 요청/응답 매핑
- 로컬 runtime 설치 가이드

완료 기준:

- 명시적 설정 없이는 실제 provider가 절대 활성화되지 않는다.
- **provider disabled**, **misconfigured**, **runtime-failed**(구현·로그에서는 `provider-misconfigured`, `provider-runtime-failed` 등 기계 판독형 식별자와 매핑 가능)가 상호 배타적으로 구분된다.
- 공통 계약을 검증하는 단위 테스트가 있다.

### [#335](https://github.com/jee1/memento/issues/335) — OpenAI adapter 연결

가장 먼저 붙일 실제 hosted provider 구현이다.

포함:

- OpenAI SDK 연동
- 공통 adapter 계약 매핑
- provider metadata/result shape 정리
- misconfiguration/runtime failure 테스트

제외:

- Gemini/Ollama
- 다중 provider fallback
- 비용 정책 일반화

완료 기준:

- 명시적 OpenAI 설정이 있을 때만 활성화된다.
- 실패 시 공통 오류 모델로 반환된다.
- mock 기반 기존 테스트는 외부 API 없이 유지된다.

### [#336](https://github.com/jee1/memento/issues/336) — Gemini adapter 연결

OpenAI와 분리된 두 번째 hosted provider 구현이다.

포함:

- Gemini SDK 연동
- 공통 adapter 계약 매핑
- provider별 오류 표면 정리

제외:

- OpenAI/Ollama
- 자동 provider 선택 정책

완료 기준:

- 명시적 Gemini 설정이 있을 때만 활성화된다.
- OpenAI 구현과 독립적으로 테스트 가능하다.

### [#337](https://github.com/jee1/memento/issues/337) — Ollama adapter + local smoke/docs

로컬 런타임 특성이 커서 별도 이슈로 둔다.

포함:

- Ollama adapter 구현
- 비활성/미설치/연결 실패 메시지
- 로컬 smoke 절차 문서
- provider 설정 가이드 갱신

제외:

- hosted provider 공통 정책 재설계
- background agent화

완료 기준:

- Ollama 미설치 상태에서 원인을 설명하는 오류가 나온다.
- 로컬에서 명시적 설정 시 smoke 절차를 따라 수동 검증할 수 있다.
- mock provider 테스트 경로는 계속 유지된다.

## 5. 권장 순서

1. [#334](https://github.com/jee1/memento/issues/334) — provider runtime contract + config gating
2. [#335](https://github.com/jee1/memento/issues/335) — OpenAI adapter 연결
3. [#336](https://github.com/jee1/memento/issues/336) — Gemini adapter 연결
4. [#337](https://github.com/jee1/memento/issues/337) — Ollama adapter + local smoke/docs

이 순서의 이유는 공통 경계를 먼저 고정해야 provider별 구현이 흔들리지 않기 때문이다. 또한 hosted provider를 먼저 정리하면 로컬 런타임 특수성이 큰 Ollama를 마지막에 별도로 닫을 수 있다.

## 6. 비목표

- `#231`~`#237` 재분해
- 여러 provider를 한 요청에서 자동 fallback 하는 정책
- 비용 최적화나 provider auto-tuning
- LLM 기반 후보 추출 고도화
- 24/7 background personal agent

## 7. GitHub 정리 방식

- `#238` 본문 상단에 “umbrella” 성격을 명시한다.
- 하위 이슈 4개([#334](https://github.com/jee1/memento/issues/334)~[#337](https://github.com/jee1/memento/issues/337))는 생성되었으며, 각 본문에 `Parent: #238`를 적는다.
- `#82`에는 `#231`~`#238`이 MVP 분해 구조임을 유지하되, `#238` 아래에 실제 provider 연결 서브트리가 있음을 링크로 보강한다.
- 기존 `#238` 본문에 있던 구현 세부사항은 하위 이슈로 이동하고, `#238` 본문에는 추적용 요약만 남긴다.

## 8. 검증

- 각 하위 이슈가 단독 PR로 닫힐 수 있는지 확인한다.
- 각 하위 이슈의 제외 범위가 겹치지 않는지 확인한다.
- `#238` 본문이 실행 이슈가 아니라 umbrella로 읽히는지 확인한다.

## 9. Umbrella(`#238`) 완료 기준 요약

`#238` GitHub 본문과 동일한 상위 완료 조건을 설계 상위에서도 고정한다.

- 실제 provider 사용은 **명시적 설정이 있을 때만** 활성화된다.
- **provider disabled** / **misconfigured** / **runtime-failed** 상태가 구분된다(구현체는 공통 오류 모델·코드로 표현).
- 각 provider 구현이 **독립 이슈(#335~#337)**로 검증 가능하다.
- **mock provider** 기반 테스트는 계속 외부 API 없이 통과한다.

(`#238` 본문의 **제외 범위**는 아래 **비목표(섹션 6)**와 동일 주제이며, “다중 provider 자동 튜닝·후보 추출 고도화·24/7 background agent”는 비목표로 유지한다.)

## 10. 권장 검증(수동·자동)

- mock provider 테스트
- provider disabled 상태 테스트
- 각 provider별 수동 smoke test(해당 하위 이슈·문서에 절차 명시)
