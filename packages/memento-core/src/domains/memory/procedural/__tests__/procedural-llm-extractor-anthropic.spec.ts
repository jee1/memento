import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mementoConfig } from '../../../../shared/config/index.js';
import { LlmProceduralExtractor } from '../procedural-llm-extractor.js';

const { constructed, createAnthropicChatLlm } = vi.hoisted(() => ({
  constructed: vi.fn(),
  createAnthropicChatLlm: vi.fn(),
}));
vi.mock('../../../../shared/services/llm-client-initializer.js', () => ({
  LLMClientInitializer: class {
    constructor() {
      constructed();
    }
    initialize = vi.fn();
  },
}));
vi.mock('../../../../shared/services/chat-llm/anthropic-chat-llm.js', () => ({ createAnthropicChatLlm }));

const saved = { llmProvider: mementoConfig.llmProvider, overrides: { ...mementoConfig.llmProviderOverrides } };

describe('LlmProceduralExtractor anthropic (#1840)', () => {
  beforeEach(() => {
    constructed.mockReset();
    createAnthropicChatLlm.mockReset();
    mementoConfig.llmProvider = 'anthropic';
    delete mementoConfig.llmProviderOverrides.procedural;
  });
  afterEach(() => {
    mementoConfig.llmProvider = saved.llmProvider;
    mementoConfig.llmProviderOverrides = saved.overrides;
  });

  it('anthropic 이면 채팅 초기화기를 만들지 않고 구조화 출력 schema 로 부른다', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ workflow_name: '백업', skill_name: 'backup_tool', steps: '["권한 확인"]', trigger_conditions: null, task_goal: '백업' }),
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    createAnthropicChatLlm.mockReturnValue({ provider: 'anthropic', complete });

    const result = await new LlmProceduralExtractor().extract({ original_task: '백업' });

    expect(result).toMatchObject({ workflow_name: '백업', skill_name: 'backup_tool' });
    expect(constructed).not.toHaveBeenCalled();
    expect(complete.mock.calls[0]![0]).toMatchObject({
      model: 'claude-haiku-5-5',
      jsonSchema: expect.objectContaining({ required: expect.arrayContaining(['workflow_name', 'steps']) }),
    });
  });

  it('키가 없거나 호출이 실패하면 null 을 돌려 규칙 추출로 가고 다른 제공자를 만들지 않는다', async () => {
    createAnthropicChatLlm.mockReturnValueOnce(null);
    expect(await new LlmProceduralExtractor().extract({ original_task: 'x' })).toBeNull();

    createAnthropicChatLlm.mockReturnValueOnce({
      provider: 'anthropic',
      complete: vi.fn().mockRejectedValue(new Error('429 rate_limit_error')),
    });
    expect(await new LlmProceduralExtractor().extract({ original_task: 'x' })).toBeNull();

    expect(constructed).not.toHaveBeenCalled();
  });
});
