import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SummarizationService } from './summarization-service.js';
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
});
