# 설계: 이슈 #264 — fallback 성공 시 relation LLM 초기화 경고 억제

**상태**: 초안 (구현 전 검토)  
**날짜**: 2026-05-10  
**이슈**: [GitHub #264](https://github.com/jee1/memento/issues/264)

---

## 1. 배경·목표

운영 로그에 아래와 같은 `LLM 초기화 경고`가 반복 기록되고 있다.

```text
LLM 초기화 경고 | {"warning":"Ollama 네트워크 에러: fetch failed"}
LLM 초기화 경고 | {"warning":"GEMINI_API_KEY가 없습니다."}
```

현재 relation 계층의 여러 서비스는 `LLMClientInitializer.initialize()`가 반환한 `warnings[]`를 그대로 `logger.warn('LLM 초기화 경고', ...)`로 재출력한다. 이때 OpenAI나 Gemini 같은 최종 provider가 정상 선택되어도, fallback 탐색 과정에서 나온 비치명 경고가 운영 `warn` 로그로 승격된다.

이번 이슈의 목표는 **최종 provider가 정상 선택된 경우에는 개별 초기화 경고를 운영 `warn`으로 남기지 않고, 모든 provider 실패 신호는 유지하는 것**이다.

**비목표**

- `LLMClientInitializationResult` 타입을 `blockingWarnings` / `nonBlockingWarnings`처럼 재설계하지 않는다.
- relation 외 다른 도메인 소비자의 경고 정책은 이번 범위에 포함하지 않는다.
- 모든 provider 실패 시의 `error` / `warn` 경로를 약화시키지 않는다.

---

## 2. 구현 접근 비교 (3안)

| 접근 | 요약 | 장점 | 단점 |
|------|------|------|------|
| **A. relation 소비 지점에서 fallback 성공 시 warn 재로그 생략** | `preferredProvider !== null`이면 `warnings[]`를 `warn`으로 다시 찍지 않는다. | 변경 범위가 작고, 실제 운영 로그 발생 지점을 바로 정리할 수 있다. | 같은 initializer를 쓰는 다른 소비자는 그대로 남는다. |
| **B. initializer 결과 타입 확장** | 경고를 치명/비치명으로 구조화한다. | 의미 계층이 가장 명확하다. | 타입, 구현, 테스트, 소비자를 넓게 건드려 `#264` 범위를 넘어선다. |
| **C. warn 대신 info/debug로 다운그레이드** | 진단 정보는 남기되 운영 warn만 줄인다. | 디버깅 정보는 보존된다. | 로그 정책이 분산되고, 운영 로그 정리 목표에는 덜 직접적이다. |

**선택**

- **A안 채택**. 이번 수정은 relation 계층의 운영 `warn` 품질을 바로잡는 데 집중한다.

---

## 3. 설계

### 3.1 동작

relation 계층의 LLM 초기화 소비 지점은 `LLMClientInitializer.initialize()` 결과를 받은 뒤, `preferredProvider`가 존재하면 `warnings[]`를 `logger.warn('LLM 초기화 경고', ...)`로 재출력하지 않는다. 대신 이미 존재하는 “초기화 완료” 로그와 선택된 provider 정보만 유지한다.

반대로 `preferredProvider === null`이면 현재와 같이 실패 신호가 남아야 한다. 즉 모든 provider가 사용 불가능한 상태는 여전히 운영 문제로 드러나야 하며, 이번 이슈는 그 경로를 감추지 않는다.

### 3.2 변경 범위

- `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts`
- `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extractor.ts`
- `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.ts`
- 관련 회귀 테스트 파일
  - fallback 성공 시 `LLM 초기화 경고` 미발생
  - 완전 실패 시 기존 실패 로그 유지

### 3.3 명시적 비범위

- `packages/memento-core/src/shared/services/llm-client-initializer.ts`의 공개 타입 재설계
- 다른 도메인에서의 LLM 초기화 경고 처리
- provider 선택 우선순위나 실제 fallback 로직 변경

---

## 4. 테스트·검증 계획

### 4.1 핵심 회귀 시나리오

`LLMClientInitializer.initialize()`가 아래와 같은 결과를 반환하는 경우를 검증한다.

- `warnings: ['GEMINI_API_KEY가 없습니다.', 'Ollama 네트워크 에러: fetch failed']`
- `preferredProvider: 'openai'` 또는 `'gemini'`

기대 결과:

- `logger.warn('LLM 초기화 경고', ...)`가 호출되지 않는다.
- 서비스는 선택된 provider를 정상 사용 가능한 상태로 유지한다.

### 4.2 실패 시나리오 보호

`preferredProvider: null`이고 초기화된 provider가 없는 경우에는:

- 기존 실패 로그(`logger.error(...)`)가 계속 남아야 한다.
- 이번 변경 때문에 실패 상태가 성공처럼 보이면 안 된다.

### 4.3 검증 실행

- 대상 relation service spec 실행
- fallback 성공/실패를 모두 포함하는 인접 spec 실행
- 코드 수정 후 graphify 재빌드

---

## 5. 실행 단위

이번 작업은 이슈별 격리를 위해 별도 워크트리와 브랜치에서 진행한다.

- 워크트리: `/home/jee1lee/git/memento/.worktrees/fix-issue-264`
- 브랜치: `fix/issue-264-llm-init-warning`

`#291`과 완전히 분리된 수정·커밋 흐름으로 유지한다.

---

## 6. 완료 조건

| 조건 | 판정 기준 |
|------|-----------|
| 운영 warn 정리 | fallback 성공 시 `LLM 초기화 경고`가 relation 계층에서 더 이상 기록되지 않는다. |
| 실패 신호 유지 | `preferredProvider === null`일 때 실패 로그는 계속 남는다. |
| 범위 통제 | initializer 타입 재설계나 다른 도메인 로그 정책까지 함께 바꾸지 않는다. |

---

## 7. Spec self-review (체크리스트)

- **Placeholder**: 없음.
- **내부 정합**: 목표는 “fallback 성공 warn 억제, 완전 실패 신호 유지”로 일관됨.
- **범위**: relation 소비 지점 + 회귀 테스트로 제한.
- **모호성 해소**: `warnings[]` 자체를 없애는 것이 아니라 relation 계층의 운영 `warn` 재로그만 억제한다.
