import { describe, it, expect, vi } from 'vitest';
import { PersonalKnowledgeAgentService } from './personal-knowledge-agent-service.js';
import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';

describe('PersonalKnowledgeAgentService', () => {
  function makeDeps() {
    const completeFn = vi.fn().mockResolvedValue({
      content: 'LLM 응답',
      metadata: {
        provider: 'mock',
        model: 'deterministic-mock-v1',
        requestId: 'mock-123',
      },
    });
    const buildContextFn = vi.fn().mockResolvedValue('컨텍스트 텍스트');
    const proposeCandidatesFn = vi.fn().mockResolvedValue(undefined);
    const persistFn = vi.fn().mockResolvedValue(undefined);

    const llm = { complete: completeFn } as unknown as ILLMPort;
    const context = { buildContext: buildContextFn, proposeCandidates: proposeCandidatesFn } as unknown as IContextPort;
    const persistence = { persist: persistFn } as unknown as IPersistencePort;

    return { llm, context, persistence, completeFn, buildContextFn, proposeCandidatesFn, persistFn };
  }

  it('mock dependency로 한 턴을 실행하고 llmResponse와 metadata를 반환한다', async () => {
    const { llm, context, persistence } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    const result = await svc.runOneTurn({ userMessage: '테스트 입력' });

    expect(result.llmResponse).toBe('LLM 응답');
    expect(result.llmMetadata).toEqual({
      provider: 'mock',
      model: 'deterministic-mock-v1',
      requestId: 'mock-123',
    });
    expect(result.persisted).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it('buildContext를 userMessage와 projectId로 호출한다', async () => {
    const { llm, context, persistence, buildContextFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '입력', projectId: 'proj-1' });

    expect(buildContextFn).toHaveBeenCalledWith('입력', 'proj-1');
  });

  it('projectId 없을 때 buildContext를 undefined로 호출한다', async () => {
    const { llm, context, persistence, buildContextFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '입력' });

    expect(buildContextFn).toHaveBeenCalledWith('입력', undefined);
  });

  it('llm.complete를 system+user 메시지로 호출한다', async () => {
    const { llm, context, persistence, completeFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '질문' });

    expect(completeFn).toHaveBeenCalledWith([
      { role: 'system', content: '컨텍스트 텍스트' },
      { role: 'user', content: '질문' },
    ]);
  });

  it('LLM 포트가 reject하면 에러를 그대로 전파한다', async () => {
    const { llm, context, persistence, completeFn } = makeDeps();
    completeFn.mockRejectedValueOnce(new Error('LLM 오류'));
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await expect(svc.runOneTurn({ userMessage: '입력' })).rejects.toThrow('LLM 오류');
  });
});
