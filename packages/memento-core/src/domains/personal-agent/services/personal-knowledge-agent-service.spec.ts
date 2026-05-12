import { describe, it, expect, vi } from 'vitest';
import { DeterministicMockLlmAdapter } from '../adapters/deterministic-mock-llm-adapter.js';
import { PersonalKnowledgeAgentService } from './personal-knowledge-agent-service.js';
import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';

describe('PersonalKnowledgeAgentService', () => {
  const mockBundle = {
    promptText: '컨텍스트 텍스트',
    itemCount: 1,
    tokenEstimate: 10,
    contextSummary: '관련 기억 1건 (episodic 1), 추정 토큰 10',
    query: 'mock-query',
  };

  function makeDeps() {
    const completeFn = vi.fn().mockResolvedValue({
      content: 'LLM 응답',
      metadata: {
        provider: 'mock',
        model: 'deterministic-mock-v1',
        requestId: 'mock-123',
      },
    });
    const buildContextFn = vi.fn().mockImplementation(async (req: { userMessage: string }) => ({
      ...mockBundle,
      query: req.userMessage,
    }));
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
    expect(result.knowledgeContext.itemCount).toBe(1);
    expect(result.knowledgeContext.tokenEstimate).toBe(10);
  });

  it('명시적 선호 신호가 있으면 후보를 추출하고 proposeCandidates에 전달한다', async () => {
    const { llm, context, persistence, proposeCandidatesFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    const msg = '앞으로는 PR 설명은 한국어로 쓰고 싶어';
    const result = await svc.runOneTurn({ userMessage: msg });

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const c = result.candidates.find((x) => x.category === 'preference');
    expect(c).toBeDefined();
    expect(c!.reason.length).toBeGreaterThan(0);
    expect(typeof c!.confidence).toBe('number');
    expect(c!.suggestedMemoryType).toBe('semantic');
    expect(proposeCandidatesFn).toHaveBeenCalledWith(result.candidates);
  });

  it('buildContext를 userMessage와 projectId로 호출한다', async () => {
    const { llm, context, persistence, buildContextFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '입력', projectId: 'proj-1' });

    expect(buildContextFn).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: '입력', projectId: 'proj-1' }),
    );
  });

  it('projectId 없을 때 buildContext에 projectId를 넣지 않는다', async () => {
    const { llm, context, persistence, buildContextFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '입력' });

    expect(buildContextFn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: '입력' }));
    const call = buildContextFn.mock.calls[0][0] as { projectId?: string };
    expect(call.projectId).toBeUndefined();
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

  it('deterministic mock adapter로 외부 API 없이 한 턴을 실행한다', async () => {
    const { context, persistence } = makeDeps();
    const llm = new DeterministicMockLlmAdapter({
      fixtures: {
        'mock-5b832cfd931a7db9': 'fixture 기반 응답',
      },
    });
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    const result = await svc.runOneTurn({ userMessage: '질문' });

    expect(result.llmResponse).toBe('fixture 기반 응답');
    expect(result.knowledgeContext.summary).toContain('관련 기억');
    expect(result.llmMetadata).toEqual({
      provider: 'mock',
      model: 'deterministic-mock-v1',
      requestId: 'mock-5b832cfd931a7db9',
      finishReason: 'stop',
    });
  });

  it('LLM 포트가 reject하면 에러를 그대로 전파한다', async () => {
    const { llm, context, persistence, completeFn } = makeDeps();
    completeFn.mockRejectedValueOnce(new Error('LLM 오류'));
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await expect(svc.runOneTurn({ userMessage: '입력' })).rejects.toThrow('LLM 오류');
  });
});
