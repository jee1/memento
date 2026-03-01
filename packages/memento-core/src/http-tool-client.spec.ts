import { describe, expect, it, vi } from 'vitest';
import { createCoreToolHttpClient } from './http-tool-client.js';

import { createCoreToolHttpClient as createFromIndex } from './index.js';

describe('createCoreToolHttpClient', () => {
  it('is importable from package root (index.js)', () => {
    expect(typeof createFromIndex).toBe('function');
    const client = createFromIndex({ serverUrl: 'http://localhost:3000' });
    expect(client).toHaveProperty('remember');
    expect(client).toHaveProperty('recall');
  });


  it('POSTs remember payload to /tools/remember', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { memory_id: 'mem-1' } }),
    });

    const client = createCoreToolHttpClient({
      serverUrl: 'http://localhost:3000',
      fetchImpl: fetchMock,
    });

    const result = await client.remember({
      content: 'Session started',
      type: 'working',
      tags: ['continuity', 'task'],
    });

    expect(result).toEqual({ memory_id: 'mem-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/tools/remember',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('POSTs recall payload to /tools/recall and normalizes items', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          items: {
            items: [
              { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
            ],
          },
        },
      }),
    });

    const client = createCoreToolHttpClient({
      serverUrl: 'http://localhost:3000',
      fetchImpl: fetchMock,
    });

    const result = await client.recall({
      query: 'memento',
      filters: { tags: ['continuity'] },
      limit: 10,
    });

    expect(result.items).toEqual([
      { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
    ]);
  });

  it('passes include_metadata to /tools/recall and preserves origin_source metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          items: {
            items: [
              {
                id: 'mem-1',
                content: 'Decision',
                tags: ['continuity', 'decision'],
                process_id: 'cursor',
                session_id: 'sess-1',
                origin_source: { project: 'memento', branch: 'feature/a' },
              },
            ],
          },
        },
      }),
    });

    const client = createCoreToolHttpClient({
      serverUrl: 'http://localhost:3000',
      fetchImpl: fetchMock,
    });

    const result = await client.recall({
      query: 'memento',
      filters: { tags: ['continuity'] },
      include_metadata: true,
      session_id: 'sess-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/tools/recall',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'memento',
          filters: { tags: ['continuity'] },
          include_metadata: true,
          session_id: 'sess-1',
        }),
      })
    );
    expect(result.items[0]).toMatchObject({
      id: 'mem-1',
      session_id: 'sess-1',
      origin_source: { project: 'memento', branch: 'feature/a' },
    });
  });
});
