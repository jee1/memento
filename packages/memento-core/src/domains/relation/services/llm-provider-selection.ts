type LlmProvider = 'openai' | 'gemini' | 'ollama';
type RequestedLlmProvider = LlmProvider | 'auto';

interface LlmProviderAvailability {
  openai: boolean;
  gemini: boolean;
  ollama: boolean;
}

interface LlmProviderSelectionOptions {
  includeOllamaInAuto?: boolean;
  includeOllamaInFallback?: boolean;
}

const FALLBACK_ORDER: Record<LlmProvider, LlmProvider[]> = {
  openai: ['openai', 'gemini', 'ollama'],
  gemini: ['gemini', 'openai', 'ollama'],
  ollama: ['ollama', 'openai', 'gemini'],
};

export function determineLlmProvider(
  requested: RequestedLlmProvider,
  availability: LlmProviderAvailability,
  options: LlmProviderSelectionOptions = {},
): LlmProvider | null {
  // #1840: 관계 추출 채팅 갈래는 anthropic 을 모른다. 다른 제공자로 넘기지 않고 없음으로 끝낸다.
  if (requested !== 'auto' && !(requested in FALLBACK_ORDER)) {
    return null;
  }
  const candidates: readonly LlmProvider[] = requested === 'auto'
    ? options.includeOllamaInAuto === false
      ? (['openai', 'gemini'] as const)
      : (['openai', 'gemini', 'ollama'] as const)
    : options.includeOllamaInFallback === false && requested !== 'ollama'
      ? FALLBACK_ORDER[requested].filter((provider) => provider !== 'ollama')
      : FALLBACK_ORDER[requested];

  return candidates.find((provider) => availability[provider]) ?? null;
}
