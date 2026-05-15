import { z } from 'zod';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

const providerEnum = z.enum(['mock', 'openai', 'gemini', 'ollama']);

export type ParsedPersonalAgentLlmEnv =
  | { provider: 'mock' }
  | { provider: 'openai'; model: string }
  | { provider: 'gemini'; model: string }
  | { provider: 'ollama'; baseUrl: string; model: string };

export type ParsePersonalAgentLlmEnvKeys = {
  openaiApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
};

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

function readProviderToken(env: NodeJS.ProcessEnv): string {
  const raw = env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER;
  if (raw === undefined || String(raw).trim() === '') {
    return 'mock';
  }
  return String(raw).trim().toLowerCase();
}

/**
 * personal-agent LLM 활성화용 환경 변수를 파싱한다.
 * API 키는 env가 아닌 `keys`로 주입해 테스트·호출부에서 통제한다.
 */
export function parsePersonalAgentLlmEnv(
  env: NodeJS.ProcessEnv,
  keys: ParsePersonalAgentLlmEnvKeys = {},
): ParsedPersonalAgentLlmEnv {
  const token = readProviderToken(env);
  const parsed = providerEnum.safeParse(token);
  if (!parsed.success) {
    throw new PersonalAgentLlmError({
      code: 'provider_misconfigured',
      message: `Invalid MEMENTO_PERSONAL_AGENT_LLM_PROVIDER: ${token}`,
    });
  }

  const provider = parsed.data;

  if (provider === 'mock') {
    return { provider: 'mock' };
  }

  if (provider === 'openai') {
    const key = keys.openaiApiKey?.trim();
    if (!key) {
      throw new PersonalAgentLlmError({
        code: 'provider_misconfigured',
        message: 'OPENAI_API_KEY (or injected openaiApiKey) is required when MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=openai',
      });
    }
    const model =
      env.MEMENTO_PERSONAL_AGENT_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
    return { provider: 'openai', model };
  }

  if (provider === 'gemini') {
    const key = keys.geminiApiKey?.trim();
    if (!key) {
      throw new PersonalAgentLlmError({
        code: 'provider_misconfigured',
        message: 'GEMINI_API_KEY (or injected geminiApiKey) is required when MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=gemini',
      });
    }
    const model =
      env.MEMENTO_PERSONAL_AGENT_GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    return { provider: 'gemini', model };
  }

  const baseUrlRaw = env.MEMENTO_PERSONAL_AGENT_OLLAMA_URL?.trim();
  const baseUrl = baseUrlRaw && baseUrlRaw.length > 0 ? baseUrlRaw : DEFAULT_OLLAMA_URL;
  const model = env.MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL?.trim();
  if (!model) {
    throw new PersonalAgentLlmError({
      code: 'provider_misconfigured',
      message: 'MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL is required when MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=ollama',
    });
  }

  return { provider: 'ollama', baseUrl, model };
}
