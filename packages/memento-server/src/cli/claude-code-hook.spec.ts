import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentEventEnvelope } from '@memento/agent-integration';

import {
  createAgentHookHttpTransport as createClaudeCodeHttpTransport,
  runAgentHookCommand,
} from './agent-hook-command.js';

function event(eventType: AgentEventEnvelope['event_type']): AgentEventEnvelope {
  return {
    contract_version: 1,
    event_id: `event-${eventType}`,
    event_type: eventType,
    occurred_at: '2026-06-07T00:00:00.000Z',
    adapter_name: 'claude-code',
    adapter_version: '0.1.0',
    session_id: 'session/1',
    sequence_no: 1,
    scope: {},
    payload: eventType === 'SESSION_START'
      ? { client_version: '2.1.153' }
      : eventType === 'PRE_COMPACT'
        ? { context_summary: 'summary', token_budget: 4096 }
        : eventType === 'STOP'
          ? { outcome: 'completed' }
          : eventType === 'USER_PROMPT'
            ? { content: 'prompt', content_format: 'text/plain' }
            : { tool_name: 'Read', outcome: 'success' },
  } as AgentEventEnvelope;
}

describe('Claude Code hook HTTP transport', () => {
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
    const transport = createClaudeCodeHttpTransport({
      port: 8080,
      apiKey: 'secret',
      fetcher,
    });

    expect(await transport([event(eventType)], new AbortController().signal))
      .toEqual({ ok: true });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:8080${expectedPath}`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
    });
  });

  it('maps auth failures without leaking response content', async () => {
    const transport = createClaudeCodeHttpTransport({
      port: 8080,
      apiKey: 'secret',
      fetcher: vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ reason_code: 'AUTH_FAILED' }),
      }),
    });

    expect(await transport([event('STOP')], new AbortController().signal))
      .toEqual({ ok: false, reason: 'AUTH_FAILED' });
  });
});

describe('runAgentHookCommand stdout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function run(stdout: string, serverJson?: object) {
    const configDir = await mkdtemp(join(tmpdir(), 'hook-cmd-'));
    try {
      if (serverJson) await writeFile(join(configDir, 'server.json'), JSON.stringify(serverJson));
      vi.stubEnv('MEMENTO_CONFIG_DIR', configDir);
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(
        ((_chunk: unknown, cb?: () => void) => { cb?.(); return true; }) as typeof process.stdout.write,
      );
      const runHook = vi.fn().mockResolvedValue({ exitCode: 0, stdout, stderr: '' });
      const code = await runAgentHookCommand(runHook, Readable.from(['{}']));
      return { code, write, runHook };
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }

  it('writes non-empty hook stdout', async () => {
    const { code, write } = await run('{"ok":true}');
    expect(code).toBe(0);
    expect(write).toHaveBeenCalledWith('{"ok":true}', expect.any(Function));
  });

  it('writes nothing when stdout is empty', async () => {
    const { write } = await run('');
    expect(write).not.toHaveBeenCalled();
  });

  it('hands the runner a recall port only when a server is registered', async () => {
    const without = await run('');
    expect(without.runHook.mock.calls[0]?.[0].directives.recall).toBeNull();
    const withServer = await run('', { port: 1, pid: 1, startedAt: 'now' });
    expect(withServer.runHook.mock.calls[0]?.[0].directives.recall).toBeTypeOf('function');
  });
});
