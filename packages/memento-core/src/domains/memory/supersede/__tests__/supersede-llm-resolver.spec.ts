import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSupersedeLlm } from '../supersede-llm-resolver.js';

const { constructed, initialize, createAnthropicChatLlm } = vi.hoisted(() => ({
  constructed: vi.fn(),
  initialize: vi.fn(),
  createAnthropicChatLlm: vi.fn(),
}));
vi.mock('../../../../shared/services/llm-client-initializer.js', () => ({
  LLMClientInitializer: class {
    constructor() {
      constructed();
    }
    initialize = initialize;
  },
}));
vi.mock('../../../../shared/services/chat-llm/anthropic-chat-llm.js', () => ({ createAnthropicChatLlm }));

const savedProvider = process.env.LLM_PROVIDER;

describe('resolveSupersedeLlm (#1840)', () => {
  beforeEach(() => {
    constructed.mockReset();
    createAnthropicChatLlm.mockReset();
    initialize.mockResolvedValue({
      preferredProvider: 'gemini',
      geminiClient: {},
      openaiClient: {},
      initializedProviders: ['gemini', 'openai'],
      warnings: [],
    });
  });
  afterEach(() => {
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedProvider;
  });

  it('anthropic 이면 Claude 포트와 기본 모델을 돌려주고 채팅 초기화기를 만들지 않는다', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const port = { provider: 'anthropic', complete: vi.fn() };
    createAnthropicChatLlm.mockReturnValue(port);

    expect(await resolveSupersedeLlm()).toEqual({ port, model: 'claude-haiku-5-5' });
    expect(constructed).not.toHaveBeenCalled();
  });

  it('anthropic 인데 키가 없으면 null 이고 Gemini, OpenAI 로 넘어가지 않는다', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    createAnthropicChatLlm.mockReturnValue(null);

    expect(await resolveSupersedeLlm()).toBeNull();
    expect(constructed).not.toHaveBeenCalled();
  });

  it('gemini 는 지금처럼 초기화기의 Gemini 클라이언트를 쓴다', async () => {
    process.env.LLM_PROVIDER = 'gemini';

    const resolved = await resolveSupersedeLlm();

    expect(resolved?.port.provider).toBe('gemini');
    expect(createAnthropicChatLlm).not.toHaveBeenCalled();
  });
});
