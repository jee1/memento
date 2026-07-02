/**
 * Shared Vitest mocks for LLMClientInitializer unit specs (import this module first).
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

const originalFetch = globalThis.fetch;
const originalAbortSignal = globalThis.AbortSignal;

export function getMockMementoConfig(): typeof mockMementoConfig {
  return mockMementoConfig;
}

vi.mock('../../../config/index.js', () => ({
  mementoConfig: mockMementoConfig
}));

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({}));
  return {
    default: MockOpenAI,
    __MockOpenAI: MockOpenAI
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: {} }))
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

export function resetLlmClientInitializerTestEnv(): void {
  vi.clearAllMocks();
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  mockMementoConfig.openaiApiKey = undefined;
  mockMementoConfig.geminiApiKey = undefined;
  mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
  mockMementoConfig.ollamaModel = 'llama3';
  mockMementoConfig.openaiLlmModel = 'gpt-4o-mini';
  mockMementoConfig.geminiModel = 'gemini-1.5-flash';
  mockMementoConfig.geminiLlmModel = 'gemini-2.0-flash';
  mockMementoConfig.llmModelOverrides = {};
  mockMementoConfig.llmProvider = 'auto';
  globalThis.fetch = originalFetch;
  globalThis.AbortSignal = originalAbortSignal;
}
