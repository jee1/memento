import { describe, expect, it, vi } from 'vitest';

import { createAssistantPanelClient } from './assistant-panel-client.js';

describe('createAssistantPanelClient', () => {
  it('calls resume_session on the assistant runtime', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          snapshot: {
            project: 'memento',
            sessionId: 'sess-1',
            resume: [],
            recentDecisions: [],
            openThreads: [],
            nextActions: [],
          },
        },
      }),
    });

    const client = createAssistantPanelClient({
      assistantServerUrl: 'http://localhost:8090',
      fetchImpl: fetchMock,
    });

    const result = await client.resume({
      project: 'memento',
      branch: 'feature/host-adapter',
      session_id: 'sess-1',
      process_id: 'cursor',
    });

    expect(result.snapshot.project).toBe('memento');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8090/assistant/tools/resume_session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: 'memento',
          branch: 'feature/host-adapter',
          session_id: 'sess-1',
          process_id: 'cursor',
        }),
      })
    );
  });

  it('delegates start/save/end actions to their runtime endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { session_id: 'sess-1', memory_id: 'mem-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { memory_id: 'mem-2' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { session_id: 'sess-1', memory_id: 'mem-3' } }),
      });

    const client = createAssistantPanelClient({
      assistantServerUrl: 'http://localhost:8090/',
      fetchImpl: fetchMock,
    });

    await client.start({
      project: 'memento',
      session_id: 'sess-1',
      process_id: 'cursor',
    });
    await client.save({
      kind: 'decision',
      content: 'Use host adapter',
      project: 'memento',
      session_id: 'sess-1',
      process_id: 'cursor',
    });
    await client.end({
      project: 'memento',
      session_id: 'sess-1',
      process_id: 'cursor',
      summary: 'Wrap up',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8090/assistant/tools/start_session',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8090/assistant/tools/save_context',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8090/assistant/tools/end_session',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws a readable error when the runtime returns an error payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'runtime unavailable' }),
    });

    const client = createAssistantPanelClient({
      assistantServerUrl: 'http://localhost:8090',
      fetchImpl: fetchMock,
    });

    await expect(
      client.resume({
        project: 'memento',
      })
    ).rejects.toThrow('runtime unavailable');
  });
});
