import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SummarizationService, type SummarizationLlmConfig } from './summarization-service.js';
import type { EpisodicCandidateRow } from '../repositories/consolidation-repository.js';

function row(id: string, content: string, importance: number): EpisodicCandidateRow {
  return {
    id,
    content,
    importance,
    ownerId: null,
    createdAt: new Date().toISOString(),
    pinned: false,
    isConsolidated: false
  };
}

function llmConfig(over: Partial<SummarizationLlmConfig> = {}): SummarizationLlmConfig {
  return {
    llmProvider: 'auto',
    llmProviderOverrides: {},
    llmModelOverrides: {},
    openaiLlmModel: 'gpt-4o-mini',
    geminiLlmModel: 'gemini-2.0-flash',
    ollamaModel: 'llama3',
    ollamaBaseUrl: 'http://ollama.test:11434',
    ...over,
  };
}

describe('SummarizationService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses extractive fallback when no LLM keys', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const svc = new SummarizationService();
    const episodes = [row('1', 'low', 0.2), row('2', 'high body', 0.95)];
    const out = await svc.summarizeCluster({ clusterEpisodes: episodes });
    expect(out.method).toBe('extractive');
    expect(out.content).toBe('high body');
  });

  it('calls OpenAI when API key present and returns summary', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '  merged summary  ' } }]
      })
    }) as any;

    const svc = new SummarizationService();
    const out = await svc.summarizeCluster({
      clusterEpisodes: [row('1', 'a', 0.5), row('2', 'b', 0.5)]
    });
    expect(out.method).toBe('llm');
    expect(out.content).toBe('merged summary');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('ollama override 가 지정되면 ollama /api/chat 을 부른다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '  ollama summary  ' } }),
    }) as any;

    const svc = new SummarizationService(
      llmConfig({ llmProviderOverrides: { consolidation: 'ollama' } }),
    );
    const out = await svc.summarizeCluster({
      clusterEpisodes: [row('1', 'a', 0.5)],
    });
    expect(out.method).toBe('llm');
    expect(out.content).toBe('ollama summary');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ollama.test:11434/api/chat',
      expect.anything(),
    );
  });

  it('ollama 는 API 키가 없어도 extractive 로 떨어지지 않는다', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '  ollama summary  ' } }),
    }) as any;

    const svc = new SummarizationService(
      llmConfig({ llmProviderOverrides: { consolidation: 'ollama' } }),
    );
    const out = await svc.summarizeCluster({
      clusterEpisodes: [row('1', 'a', 0.5)],
    });
    expect(out.method).toBe('llm');
  });

  it('provider 가 gemini 면 OPENAI_API_KEY 가 있어도 openai 를 부르지 않는다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('GEMINI_API_KEY', 'g-test');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'gemini summary' }] } }],
      }),
    }) as any;

    const svc = new SummarizationService(llmConfig({ llmProvider: 'gemini' }));
    const out = await svc.summarizeCluster({
      clusterEpisodes: [row('1', 'a', 0.5)],
    });
    expect(out.content).toBe('gemini summary');
    const url = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(url).toContain('generativelanguage.googleapis.com');
  });

  it('provider 가 ollama 면 OPENAI_API_KEY 가 있어도 openai 를 부르지 않는다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '  ollama summary  ' } }),
    }) as any;

    const svc = new SummarizationService(
      llmConfig({ llmProviderOverrides: { consolidation: 'ollama' } }),
    );
    await svc.summarizeCluster({
      clusterEpisodes: [row('1', 'a', 0.5)],
    });
    const url = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(url).toContain('/api/chat');
  });
});
