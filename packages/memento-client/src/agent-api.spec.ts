import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MementoClient } from './memento-client.js';

describe('MementoClient agent API transport', () => {
  let client: MementoClient;
  let http: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    client = new MementoClient({ apiKey: 'test-key', logLevel: 'silent' });
    http = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    Object.assign(client as unknown as Record<string, unknown>, {
      httpClient: http,
      isConnected: true,
    });
  });

  it('discovers agent integration capabilities', async () => {
    http.get.mockResolvedValue({ data: { contract_versions: [1], schema_ready: true } });

    await expect(client.getAgentCapabilities()).resolves.toMatchObject({
      contract_versions: [1],
      schema_ready: true,
    });
    expect(http.get).toHaveBeenCalledWith('/api/v1/agent/capabilities');
  });

  it('sends lifecycle events to start, ingest, pre-compact, and stop endpoints', async () => {
    const start = { event_id: 'start', session_id: 'session-1' };
    const prompt = { event_id: 'prompt', session_id: 'session-1' };
    http.post.mockResolvedValue({ data: { ok: true } });

    await client.startAgentSession(start);
    await client.ingestAgentObservations([prompt]);
    await client.preCompactAgentSession('session-1', prompt);
    await client.stopAgentSession('session-1', prompt);

    expect(http.post.mock.calls).toEqual([
      ['/api/v1/agent/sessions', start],
      ['/api/v1/agent/observations:ingest', { events: [prompt] }],
      ['/api/v1/agent/sessions/session-1:pre-compact', prompt],
      ['/api/v1/agent/sessions/session-1:stop', prompt],
    ]);
  });

  it('reads timeline and provenance and supports export and delete policy calls', async () => {
    http.get.mockResolvedValue({ data: { ok: true } });
    http.post.mockResolvedValue({ data: { ok: true } });
    http.delete.mockResolvedValue({ data: undefined });

    await client.getAgentSession('session-1');
    await client.listAgentObservations('session-1', { cursor: 'next', limit: 25 });
    await client.getAgentProvenance({ memory_id: 'memory-1', max_depth: 3 });
    await client.linkAgentProvenance({
      memory_id: 'memory-1',
      session_id: 'session-1',
      derivation_type: 'agent_capture',
    });
    await client.exportAgentSession('session-1');
    await client.deleteAgentSession('session-1');

    expect(http.get.mock.calls).toEqual([
      ['/api/v1/agent/sessions/session-1'],
      ['/api/v1/agent/sessions/session-1/observations', {
        params: { cursor: 'next', limit: 25 },
      }],
      ['/api/v1/agent/provenance', {
        params: { memory_id: 'memory-1', max_depth: 3 },
      }],
      ['/api/v1/agent/sessions/session-1/export'],
    ]);
    expect(http.post).toHaveBeenCalledWith('/api/v1/agent/provenance', {
      memory_id: 'memory-1',
      session_id: 'session-1',
      derivation_type: 'agent_capture',
    });
    expect(http.delete).toHaveBeenCalledWith('/api/v1/agent/sessions/session-1');
  });
});
