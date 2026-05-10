# 설계: 이슈 #233 — LLM adapter 인터페이스와 deterministic mock provider 추가

**날짜**: 2026-05-10  
**이슈**: [#233](https://github.com/jee1/memento/issues/233)  
**부모**: [#82](https://github.com/jee1/memento/issues/82) 개인 지식 축적 Agent MVP  
**선행 작업**: [#231](https://github.com/jee1/memento/issues/231) PersonalKnowledgeAgentService 계약 추가  
**상태**: 설계 완료, 구현 대기

---

## 1. 목표

개인 지식 Agent Loop가 실제 OpenAI/Gemini/Ollama provider에 묶이지 않고 테스트될 수 있도록 `personal-agent` 도메인의 LLM 포트 계약을 확장하고 deterministic mock adapter를 추가한다.

이번 작업은 외부 API 호출을 만들지 않는다. 대신 #238 실제 provider adapter가 따를 수 있는 최소 계약을 먼저 고정한다.

---

## 2. 범위

### 포함
- `ILLMPort.complete()` 반환값을 문자열에서 `LLMCompletionResult` 객체로 확장
- 안전한 provider metadata 타입 추가
- deterministic mock LLM adapter 구현
- mock adapter 단위 테스트
- `PersonalKnowledgeAgentService`가 mock adapter를 주입받아 외부 API 없이 실행되는 통합 수준 테스트

### 제외
- OpenAI/Gemini/Ollama 실제 호출
- provider fallback 정책
- 비용, timeout, retry 정책
- 후보 추출 로직 고도화 (#234)
- 실제 provider runtime config gating (#238 하위 이슈)

---

## 3. 파일 구조

```text
packages/memento-core/src/domains/personal-agent/
├── adapters/
│   ├── deterministic-mock-llm-adapter.ts
│   └── deterministic-mock-llm-adapter.spec.ts
├── ports/
│   └── llm-port.ts
├── services/
│   ├── personal-knowledge-agent-service.ts
│   └── personal-knowledge-agent-service.spec.ts
├── types/
│   └── agent-types.ts
└── index.ts
```

`adapters/`는 포트 구현체를 두는 경계다. 실제 provider adapter는 #238 하위 이슈에서 같은 디렉터리나 provider별 하위 디렉터리로 확장할 수 있다.

---

## 4. LLM 포트 계약

`ports/llm-port.ts`를 다음 형태로 확장한다.

```typescript
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProviderMetadata {
  provider: 'mock' | 'openai' | 'gemini' | 'ollama';
  model?: string;
  requestId?: string;
  finishReason?: string;
}

export interface LLMCompletionResult {
  content: string;
  metadata: LLMProviderMetadata;
}

export interface ILLMPort {
  complete(messages: LLMMessage[]): Promise<LLMCompletionResult>;
}
```

metadata에는 provider 식별, 모델명, 요청 식별자, 종료 사유처럼 Agent Loop 결과에 노출해도 안전한 정보만 담는다. API key, endpoint, raw provider response, token-level payload처럼 민감하거나 provider별로 큰 객체는 포함하지 않는다.

---

## 5. Agent Loop 반영

`PersonalKnowledgeAgentResult`에 `llmMetadata?: LLMProviderMetadata`를 추가한다.

```typescript
export interface PersonalKnowledgeAgentResult {
  candidates: KnowledgeCandidate[];
  llmResponse: string;
  llmMetadata?: LLMProviderMetadata;
  persisted: boolean;
}
```

`PersonalKnowledgeAgentService.runOneTurn()`는 `ILLMPort.complete()`의 결과를 받아 다음처럼 매핑한다.

- `llmResult.content` → 기존 `llmResponse`
- `llmResult.metadata` → 신규 `llmMetadata`

기존 호출자는 `llmResponse` 문자열을 계속 사용할 수 있다. metadata는 선택 필드로 노출하여 실제 provider 연결 전에도 Agent Loop 테스트에서 provider 정보를 검증할 수 있게 한다.

---

## 6. Deterministic Mock Adapter

새 구현체는 `DeterministicMockLlmAdapter`로 둔다.

```typescript
export interface DeterministicMockLlmAdapterOptions {
  model?: string;
  fixtures?: Record<string, string>;
}

export class DeterministicMockLlmAdapter implements ILLMPort {
  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult>;
}
```

동작 규칙:

- 입력 `messages`를 안정적으로 직렬화한다.
- 직렬화된 입력에서 deterministic hash를 만든다.
- `requestId`는 hash 기반 문자열로 생성한다.
- `fixtures[requestId]`가 있으면 그 값을 `content`로 반환한다.
- fixture가 없으면 `Mock response: <requestId>` 형식의 기본 응답을 반환한다.
- metadata는 `{ provider: 'mock', model: 'deterministic-mock-v1', requestId }`를 기본으로 반환한다.

fixture는 외부 파일이 아니라 생성자 옵션으로 주입한다. 이렇게 하면 테스트가 파일 I/O 없이 빠르게 실행되고, fixture 응답 우선순위가 명시적으로 드러난다.

---

## 7. Export

`personal-agent/index.ts`에서 다음을 추가 export한다.

- `LLMProviderMetadata`
- `LLMCompletionResult`
- `DeterministicMockLlmAdapter`
- `DeterministicMockLlmAdapterOptions`

도메인 외부에서는 `personal-agent` entrypoint를 통해 포트 타입과 mock adapter를 사용할 수 있게 한다.

---

## 8. 테스트

### Mock adapter 단위 테스트

| 케이스 | 검증 내용 |
|---|---|
| 같은 입력 반복 호출 | 같은 `content`, `requestId`, metadata 반환 |
| 다른 입력 호출 | 다른 `requestId` 반환 |
| fixture 제공 | `fixtures[requestId]` 응답이 기본 응답보다 우선 |
| metadata 안전성 | provider/model/requestId 중심의 제한된 metadata만 반환 |

### Agent Loop 테스트

기존 `personal-knowledge-agent-service.spec.ts`를 새 포트 반환 타입에 맞춘다.

추가로 `DeterministicMockLlmAdapter`를 실제 주입하여 한 턴 실행을 검증한다.

- 외부 API 없이 실행된다.
- `llmResponse`가 mock adapter의 `content`와 같다.
- `llmMetadata.provider`가 `mock`이다.
- 기존 LLM reject 전파 테스트는 유지한다.

---

## 9. 오류 처리

Mock adapter 자체는 정상 입력에서 실패하지 않는다.

`PersonalKnowledgeAgentService`는 기존처럼 `llm.complete()`가 reject하면 에러를 감싸지 않고 전파한다. 실제 provider 오류 모델, timeout, fallback은 #238 하위 이슈에서 다룬다.

---

## 10. 완료 기준

- 같은 입력은 같은 mock 응답과 같은 `requestId`를 반환한다.
- 다른 입력은 다른 `requestId`를 반환한다.
- Agent Loop 통합 테스트가 외부 API 없이 mock adapter로 실행된다.
- provider metadata가 `PersonalKnowledgeAgentResult.llmMetadata`에 안전하게 포함된다.
- `npm run type-check` 통과
- 관련 Vitest 통과

---

## 11. 후속 이슈 연결

| 이슈 | 연결 지점 |
|---|---|
| #234 | `llmResponse` 또는 구조화 출력 기반 후보 추출 |
| #235 | 승인 기반 persistence 경로 |
| #236 | CLI에서 mock/real provider 선택 경로 |
| #238 | 실제 OpenAI/Gemini/Ollama adapter가 `ILLMPort` 계약 구현 |

---

## 12. 비목표

- 실제 provider SDK 연동을 미리 위한 추상 팩토리를 만들지 않는다.
- provider별 옵션을 이번 mock adapter에 섞지 않는다.
- raw provider response를 Agent Loop 결과에 노출하지 않는다.
- snapshot 테스트를 만들지 않는다. 결정성은 명시적 값 비교로 검증한다.
