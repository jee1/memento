import type { LLMProvider } from '../types/memory.types.js';

const ALLOWED_LLM_PROVIDERS = new Set<LLMProvider>(['openai', 'gemini', 'ollama', 'auto']);

export type ParseLlmProviderOverrideResult = {
  value?: LLMProvider;
  invalidRaw?: string;
};

export function parseLlmProviderOverride(raw: string | undefined): ParseLlmProviderOverrideResult {
  if (raw === undefined) {
    return {};
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return {};
  }
  if (ALLOWED_LLM_PROVIDERS.has(normalized as LLMProvider)) {
    return { value: normalized as LLMProvider };
  }
  return { invalidRaw: raw.trim() };
}

export function loadLlmProviderOverrideFromEnv(
  envKey: string,
  raw: string | undefined,
  warnedKeys: Set<string>
): LLMProvider | undefined {
  const parsed = parseLlmProviderOverride(raw);
  if (parsed.invalidRaw !== undefined && !warnedKeys.has(envKey)) {
    warnedKeys.add(envKey);
    process.stderr.write(
      `[CONFIG WARN] Invalid ${envKey}="${parsed.invalidRaw}"; ignoring per-job LLM provider override.\n`
    );
  }
  return parsed.value;
}
