/**
 * Shared mocks for LLM provider integration specs (import first).
 */
import { vi } from 'vitest';

const mockMementoConfig = vi.hoisted(() => ({
  openaiApiKey: undefined as string | undefined,
  geminiApiKey: undefined as string | undefined,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  openaiLlmModel: 'gpt-4o-mini',
  geminiModel: 'gemini-1.5-flash',
  geminiLlmModel: 'gemini-2.0-flash',
  llmModelOverrides: {},
  llmProvider: 'auto' as const
}));

const defaultFetch = globalThis.fetch;
const defaultAbortSignal = globalThis.AbortSignal;

export function getMockMementoConfig(): typeof mockMementoConfig {
  return mockMementoConfig;
}

vi.mock('../../../../../shared/config/index.js', () => ({
  mementoConfig: mockMementoConfig
}));

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({}));
  return {
    default: MockOpenAI,
    __MockOpenAI: MockOpenAI
  };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../../../../shared/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../../../../shared/config/environment.js', () => ({
  getRawEnvValue: vi.fn((key: string) => {
    return process.env[key];
  })
}));

export function resetLlmProviderIntegrationTestEnv(): void {
  vi.clearAllMocks();
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  mockMementoConfig.llmProvider = 'auto';
  mockMementoConfig.openaiApiKey = undefined;
  mockMementoConfig.geminiApiKey = undefined;
  mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
  mockMementoConfig.ollamaModel = 'llama3';
  mockMementoConfig.openaiLlmModel = 'gpt-4o-mini';
  mockMementoConfig.geminiModel = 'gemini-1.5-flash';
  mockMementoConfig.geminiLlmModel = 'gemini-2.0-flash';
  mockMementoConfig.llmModelOverrides = {};
  globalThis.fetch = defaultFetch;
  globalThis.AbortSignal = defaultAbortSignal;
}
