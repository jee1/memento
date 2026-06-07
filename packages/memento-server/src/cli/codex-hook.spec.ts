import { describe, expect, it, vi } from 'vitest';

import type { AgentEventEnvelope } from '@memento/agent-integration';

import { createCodexHttpTransport } from './codex-hook.js';

function event(eventType: AgentEventEnvelope['event_type']): AgentEventEnvelope {
  return {
    contract_version: 1,
    event_id: `event-${eventType}`,
    event_type: eventType,
    occurred_at: '2026-06-07T00:00:00.000Z',
    adapter_name: 'codex',
    adapter_version: '0.1.0',
    session_id: 'session/1',
    sequence_no: 1,
    scope: {},
    payload: eventType === 'SESSION_START'
      ? { client_version: '0.137.0' }
      : eventType === 'PRE_COMPACT'
        ? { context_summary: 'summary', token_budget: 4096 }
        : eventType === 'STOP'
          ? { outcome: 'completed' }
          : eventType === 'USER_PROMPT'
            ? { content: 'prompt', content_format: 'text/plain' }
            : { tool_name: 'apply_patch', outcome: 'success' },
  } as AgentEventEnvelope;
}

describe('Codex hook HTTP transport', () => {
  it.each([
    ['SESSION_START', '/api/v1/agent/sessions'],
    ['USER_PROMPT', '/api/v1/agent/observations:ingest'],
    ['TOOL_RESULT', '/api/v1/agent/observations:ingest'],
    ['PRE_COMPACT', '/api/v1/agent/sessions/session%2F1:pre-compact'],
    ['STOP', '/api/v1/agent/sessions/session%2F1:stop'],
  ] as const)('routes %s to %s', async (eventType, expectedPath) => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    const transport = createCodexHttpTransport({
      port: 8080,
      apiKey: 'secret',
      fetcher,
    });
    expect(await transport([event(eventType)], new AbortController().signal))
      .toEqual({ ok: true });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:8080${expectedPath}`);
  });
});
