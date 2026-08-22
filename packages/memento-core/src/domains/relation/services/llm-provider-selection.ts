export type LlmProvider = 'openai' | 'gemini' | 'ollama';
export type RequestedLlmProvider = LlmProvider | 'auto';

export interface LlmProviderAvailability {
  openai: boolean;
  gemini: boolean;
  ollama: boolean;
}

export interface LlmProviderSelectionOptions {
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
  const candidates: readonly LlmProvider[] = requested === 'auto'
    ? options.includeOllamaInAuto === false
      ? (['openai', 'gemini'] as const)
      : (['openai', 'gemini', 'ollama'] as const)
    : options.includeOllamaInFallback === false && requested !== 'ollama'
      ? FALLBACK_ORDER[requested].filter((provider) => provider !== 'ollama')
      : FALLBACK_ORDER[requested];

  return candidates.find((provider) => availability[provider]) ?? null;
}
