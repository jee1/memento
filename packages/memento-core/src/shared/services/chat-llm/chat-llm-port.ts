/**
 * 채팅 LLM 포트.
 *
 * 출력 상한, thinking 정책, provider 별 파라미터 이름(`max_completion_tokens`,
 * `maxOutputTokens`, `num_predict`)은 이 포트의 어댑터에만 둔다. 호출부는
 * 상한 값을 넘기고 변환은 모른다 (#1532).
 *
 * provider 선택과 모델 결정은 포트 밖이다. 호출부가 `llm-model-resolver` 로
 * 모델을 정해 `model` 로 넘긴다.
 */

export type ChatLlmProvider = 'openai' | 'gemini' | 'ollama' | 'anthropic';

export interface ChatLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatLlmRequest {
  model: string;
  messages: ChatLlmMessage[];
  temperature: number;
  /** provider 별 상한 파라미터로 어댑터가 변환한다. */
  maxOutputTokens: number;
  /** true 면 provider 의 JSON 전용 응답 모드를 켠다. */
  json: boolean;
  /** 있으면 구조화 출력을 지원하는 어댑터(anthropic)가 이 JSON schema 로 응답을 묶는다. 나머지는 무시한다. */
  jsonSchema?: Record<string, unknown>;
  /** 있으면 요청 하나의 시간 제한(ms). 지원하는 어댑터(anthropic)만 쓴다. */
  timeoutMs?: number;
}

export interface ChatLlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatLlmResult {
  content: string;
  usage: ChatLlmUsage;
}

export interface ChatLlmPort {
  readonly provider: ChatLlmProvider;
  complete(request: ChatLlmRequest): Promise<ChatLlmResult>;
}
