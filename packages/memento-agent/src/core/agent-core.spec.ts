import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentCore } from './agent-core.js';
import { NoopLLMProvider } from '../providers/llm/noop-llm-provider.js';
import { NoopSearchProvider } from '../providers/search/noop-search-provider.js';
import type { MementoClient } from '@memento/client';

function makeMockClient(): MementoClient {
  return {
    recall: vi.fn().mockResolvedValue({ items: [], total_count: 0, query_time: 0 }),
    remember: vi.fn().mockResolvedValue({ memory_id: 'abc', created_at: '' }),
  } as unknown as MementoClient;
}

describe('AgentCore', () => {
  let client: MementoClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('returns an answer string', async () => {
    const core = new AgentCore(client, new NoopLLMProvider('answer text'), new NoopSearchProvider());
    const result = await core.ask('any question');
    expect(result.answer).toBe('answer text');
  });

  it('includes usedMemories from recall', async () => {
    const fakeMemory = {
      id: '1', content: 'past thing', type: 'episodic', score: 0.9,
      importance: 0.5, created_at: '', pinned: false, privacy_scope: 'private',
    };
    vi.mocked(client.recall).mockResolvedValue({
      items: [fakeMemory as never],
      total_count: 1,
      query_time: 0,
    });

    const core = new AgentCore(client, new NoopLLMProvider(), new NoopSearchProvider());
    const result = await core.ask('question');
    expect(result.usedMemories).toHaveLength(1);
    expect(result.usedMemories[0].id).toBe('1');
  });

  it('saves answer as episodic memory after completing', async () => {
    const core = new AgentCore(client, new NoopLLMProvider('saved answer'), new NoopSearchProvider());
    await core.ask('question');
    expect(client.remember).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'episodic' })
    );
  });

  it('continues when search fails', async () => {
    const failSearch = { search: vi.fn().mockRejectedValue(new Error('network error')) };
    const core = new AgentCore(client, new NoopLLMProvider(), failSearch);
    const result = await core.ask('question');
    expect(result.searchResults).toEqual([]);
    expect(result.answer).toBeDefined();
  });
});
