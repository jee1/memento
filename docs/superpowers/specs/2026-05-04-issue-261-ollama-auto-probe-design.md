# 설계: 이슈 #261 — `LLM_PROVIDER=auto` 시 불필요한 Ollama 연결 프로브 제거

**날짜**: 2026-05-04  
**이슈**: [GitHub #261](https://github.com/jee1/memento/issues/261)  
**관련**: [GitHub #262](https://github.com/jee1/memento/issues/262), [#263](https://github.com/jee1/memento/issues/263) (동일 초기화 경로에서 파생된 로그 모니터 이슈 가능)

---

## 1. 배경·문제

- `LLMClientInitializer.initialize()`는 `LLM_PROVIDER`가 `ollama` 또는 `auto`일 때 **항상** `testOllamaConnection()`을 호출한다 (`packages/memento-core/src/shared/services/llm-client-initializer.ts`).
- `determineProviderForAuto()`는 이미 **OpenAI → Gemini → Ollama** 우선순위로 `preferredProvider`를 고른다. 즉 `openaiClient` 또는 `geminiClient`가 살아 있으면 최종 선택에 Ollama가 쓰이지 않는다.
- 그럼에도 `auto`에서는 클라우드 클라이언트가 있어도 `localhost:11434`에 `fetch`를 보내고, Ollama 미기동 시 `RetryManager`의 `onRetry`가 `logger.warn`으로 **재시도마다** 로그를 남긴다. 이슈 #261의 `fetch failed`·64회 누적은 이 동작과 일치한다.
- `TripleExtractionService` 등이 인스턴스마다 `LLMClientInitializer`를 호출하므로, 동일 프로세스에서 경고가 **중복·증폭**될 수 있다.

---

## 2. 목표·비목표

**목표**

- `LLM_PROVIDER === 'auto'`이고 **이미 사용 가능한 클라우드 클라이언트가 하나라도 있으면** Ollama 연결 테스트(`GET …/api/tags`)를 **수행하지 않는다**.
- `LLM_PROVIDER === 'ollama'`이거나, `auto`이면서 **OpenAI·Gemini 클라이언트가 모두 null**인 경우에는 **기존과 같이** Ollama 연결 테스트를 수행한다(로컬 전용·키 없음 환경).
- 동작 변경은 “불필요한 네트워크 호출·로그” 제거에 한정되며, `preferredProvider` 결정 규칙은 기존 `determineProviderForAuto`와 **모순되지 않아야** 한다.

**비목표**

- Ollama 서버 설치/운영 문서 전면 개편(필요 시 README 한 줄 보강은 구현 PR에서 선택).
- `LLM_PROVIDER=ollama`일 때의 재시도 횟수·타임아웃 값 변경(별도 이슈).
- 프로세스 간 공유되는 전역 Ollama 가용성 캐시(TTL)·로그 레벨만 내리는 방식만으로 끝내기(본 설계의 1차 범위 아님; 추후 옵션).

---

## 3. 채택한 접근 (사용자 확인: 옵션 A)

| 옵션 | 설명 | 채택 |
|------|------|------|
| A | `auto`에서 `openaiClient != null \|\| geminiClient != null`이면 `testOllamaConnection` 스킵 | **예** |
| B | 프로세스 단위 실패 캐시로 프로브 횟수만 감소 | 1차 비채택 |
| C | 재시도 로그를 `debug`로만 | 근본 부하는 남음; 보조만 |

---

## 4. 동작 명세

### 4.1 `initialize()` 내 조건 (의사코드)

```
selectedProvider := getSelectedProvider()
result.openaiClient := initializeOpenAI(...)
result.geminiClient := initializeGemini(...)

if selectedProvider === 'ollama':
  await testOllamaConnection(result, selectedProvider)
else if selectedProvider === 'auto':
  if result.openaiClient === null && result.geminiClient === null:
    await testOllamaConnection(result, selectedProvider)
  // else: 스킵 — Ollama 프로브 없음, initializedProviders에 ollama 없음 유지
else:
  // 'openai' | 'gemini' — 기존대로 Ollama 테스트 없음
```

### 4.2 불변식

- `determinePreferredProvider` / `determineProviderForAuto` 로직은 **수정하지 않아도** 된다. 스킵 시 `initializedProviders`에 `ollama`가 없고 클라우드 클라이언트가 있으면 `openai` 또는 `gemini`가 선택된다.
- `selectedProvider === 'auto'`이고 클라우드가 모두 null일 때만 기존과 동일하게 Ollama를 프로브한다.

### 4.3 명시적 가정(문서화)

- “OpenAI/Gemini **키는 있으나** 런타임에서 API가 막히고, 대안으로 로컬 Ollama만 살아 있는” 경우는 본 설계로 **자동 전환되지 않는다**. 현재도 초기화 시점에 고정된 `preferredProvider`이며, 그런 동적 장애 복구는 범위 밖이다.

---

## 5. 구현 터치포인트

- **파일**: `packages/memento-core/src/shared/services/llm-client-initializer.ts` — `initialize()`의 Ollama 테스트 호출 조건만 조정.
- **선택**: 스킵 시 `logger.debug` 한 줄(예: “auto: cloud client present, skipping Ollama probe”) — 운영에서 원인 추적 필요 시에만; 기본은 YAGNI로 생략 가능.

---

## 6. 테스트

- **신규 또는 기존 보강**: `LLM_PROVIDER=auto` + OpenAI(또는 Gemini) 클라이언트가 성공적으로 생성되는 모킹 환경에서, Ollama `fetch` 모킹이 **호출되지 않음**을 검증한다 (`vi.mock`된 `fetch` 또는 기존 `llm-client-initializer.test-setup` 패턴 재사용).
- **회귀**: `auto`이고 클라우드 키가 없을 때는 기존 스펙대로 Ollama 프로브가 실행되는지 유지한다 (`llm-provider-fallback-auto.spec.ts` 등).

---

## 7. 이슈 #261 triage 메모

- 운영 로그에 남은 `fetch failed`는 **환경적으로 Ollama 미응답**이 맞다. 코드 변경 후에는 “클라우드만 쓰는 `auto`” 배포에서 해당 WARN 폭주는 **재현되지 않아야** 한다.
- `LLM_PROVIDER=ollama`로 두고 Ollama를 쓰려는 경우에는 여전히 Ollama 기동이 필요하다.

---

## 8. 승인·다음 단계

- 본 문서는 사용자 옵션 **A(조건부 스킵)** 확정에 따른 설계이다.
- 구현 전 **`writing-plans`** 스킬로 태스크 분해(파일 단위·테스트 파일)를 수행한다.
