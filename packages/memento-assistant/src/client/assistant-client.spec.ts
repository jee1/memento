import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AssistantClient } from './assistant-client.js';

describe('AssistantClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resumeSession should POST to /assistant/tools/resume_session', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            snapshot: {
              resume: [],
              recentDecisions: [],
              openThreads: [],
              nextActions: [],
            },
          },
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new AssistantClient({
      assistantServerUrl: 'http://localhost:8090',
    });
    const result = await client.resumeSession({
      project: 'memento',
      process_id: 'cursor',
      session_id: 'sess-1',
    });

    expect(result.snapshot.resume).toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8090/assistant/tools/resume_session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: 'memento',
          process_id: 'cursor',
          session_id: 'sess-1',
        }),
      })
    );
  });
});
