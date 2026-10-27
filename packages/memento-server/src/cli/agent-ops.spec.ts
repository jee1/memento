import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  reasonGuide,
  runAgentOpsCommand,
  type AgentOpsRequest,
} from './agent-ops.js';

function response(status: number, body: unknown) {
  return { status, body };
}

function baseDependencies(request: AgentOpsRequest) {
  return {
    request,
    resolveEndpoint: vi.fn().mockResolvedValue('http://127.0.0.1:8080'),
    now: () => new Date('2026-06-07T00:00:00.000Z'),
    randomId: () => 'fixed-id',
    writeStdout: vi.fn(),
    writeStderr: vi.fn(),
    env: { ADMIN_API_KEY: 'do-not-print' },
  };
}

describe('agent operations CLI', () => {
  it('doctor verifies health, auth, schema, contract, redaction, and cleanup without leaks', async () => {
    const request = vi.fn<AgentOpsRequest>(async (path, init) => {
      if (path === '/health') {
        return response(200, { status: 'healthy', version: '1.17.0', database: 'connected' });
      }
      if (path === '/api/v1/agent/capabilities') {
        return response(200, {
          contract_versions: [1],
          event_types: ['SESSION_START', 'USER_PROMPT', 'TOOL_RESULT', 'PRE_COMPACT', 'STOP'],
          schema_ready: true,
        });
      }
      if (path === '/api/v1/agent/sessions' && init?.method === 'POST') {
        return response(201, {
          observation: { status: 'REDACTED' },
          result: { reason_code: 'NONE' },
        });
      }
      if (path.endsWith('/export')) {
        return response(200, {
          observations: [{
            status: 'REDACTED',
            payload_json: '{"password":"[REDACTED:SECRET_KEY]"}',
          }],
        });
      }
      if (init?.method === 'DELETE') return response(204, null);
      throw new Error(`Unexpected request ${path}`);
    });
    const dependencies = baseDependencies(request);

    const code = await runAgentOpsCommand('doctor', ['--json'], dependencies);

    expect(code).toBe(0);
    const output = vi.mocked(dependencies.writeStdout).mock.calls[0]?.[0] as string;
    const result = JSON.parse(output) as {
      ok: boolean;
      checks: Array<{ name: string; status: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'endpoint', status: 'pass' }),
      expect.objectContaining({ name: 'auth', status: 'pass' }),
      expect.objectContaining({ name: 'schema', status: 'pass' }),
      expect.objectContaining({ name: 'contract', status: 'pass' }),
      expect.objectContaining({ name: 'redaction', status: 'pass' }),
      expect.objectContaining({ name: 'cleanup', status: 'pass' }),
    ]));
    expect(output).not.toContain('do-not-print');
    expect(output).not.toContain('memento-doctor-secret');
    expect(request).toHaveBeenCalledWith(
      '/api/v1/agent/sessions/memento-doctor-fixed-id',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('doctor human output preserves compatibility and guidance without sensitive values', async () => {
    const request = vi.fn<AgentOpsRequest>(async (path, init) => {
      if (path === '/health') {
        return response(200, { status: 'healthy', version: '1.17.0', database: 'connected' });
      }
      if (path === '/api/v1/agent/capabilities') {
        return response(200, {
          contract_versions: [1],
          event_types: ['SESSION_START', 'USER_PROMPT', 'TOOL_RESULT', 'PRE_COMPACT', 'STOP'],
          schema_ready: true,
        });
      }
      if (path === '/api/v1/agent/sessions' && init?.method === 'POST') {
        return response(201, {
          observation: { status: 'REDACTED' },
          result: { reason_code: 'NONE' },
        });
      }
      if (path.endsWith('/export')) {
        return response(200, {
          observations: [{
            status: 'REDACTED',
            payload_json: '{"password":"[REDACTED:SECRET_KEY]"}',
          }],
        });
      }
      if (init?.method === 'DELETE') return response(204, null);
      throw new Error(`Unexpected request ${path}`);
    });
    const dependencies = baseDependencies(request);

    expect(await runAgentOpsCommand('doctor', [], dependencies)).toBe(0);

    const output = vi.mocked(dependencies.writeStdout).mock.calls[0]?.[0] as string;
    expect(output).toContain('claude-code');
    expect(output).toContain('codex');
    expect(output).toContain('compatible');
    expect(output).not.toContain('do-not-print');
    expect(output).not.toContain('memento-doctor-secret');
  });

  it.each([
    [401, 'AUTH_FAILED'],
    [503, 'SCHEMA_NOT_READY'],
  ])('doctor classifies HTTP %s as %s', async (status, reasonCode) => {
    const request = vi.fn<AgentOpsRequest>(async (path) => {
      if (path === '/health') {
        return response(200, { status: 'healthy', version: '1.17.0', database: 'connected' });
      }
      return response(status, { reason_code: reasonCode });
    });
    const dependencies = baseDependencies(request);

    const code = await runAgentOpsCommand('doctor', ['--json'], dependencies);

    expect(code).toBe(1);
    const output = vi.mocked(dependencies.writeStdout).mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      guidance: [expect.objectContaining({ reason_code: reasonCode })],
    });
  });

  it('status forwards bounded query and returns machine-readable summary', async () => {
    const request = vi.fn<AgentOpsRequest>().mockResolvedValue(response(200, {
      generated_at: '2026-06-07T00:00:00.000Z',
      counts: { captures: 3, injections: 2, dropped: 1, degraded: 1 },
      recent_events: [],
    }));
    const dependencies = baseDependencies(request);

    expect(await runAgentOpsCommand(
      'status',
      ['--since', '24h', '--limit', '20', '--json'],
      dependencies,
    )).toBe(0);
    expect(request).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/agent\/operations\/status\?/),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(JSON.parse(
      vi.mocked(dependencies.writeStdout).mock.calls[0]?.[0] as string,
    )).toMatchObject({
      command: 'status',
      ok: true,
      summary: {
        counts: { captures: 3, injections: 2, dropped: 1, degraded: 1 },
      },
    });
  });

  it('demo verifies first-session summary reuse and cleans up both sessions', async () => {
    const deleted: string[] = [];
    const request = vi.fn<AgentOpsRequest>(async (path, init) => {
      if (path === '/health') {
        return response(200, { status: 'healthy', version: '1.17.0', database: 'connected' });
      }
      if (path === '/api/v1/agent/capabilities') {
        return response(200, { contract_versions: [1], schema_ready: true });
      }
      if (path === '/api/v1/agent/sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { session_id: string };
        return response(201, {
          result: { status: 'ACCEPTED', reason_code: 'NONE' },
          initial_injection: body.session_id.endsWith('-2')
            ? {
                status: 'ok',
                items: [{ memory_id: 'summary-memory-1' }],
              }
            : { status: 'empty', items: [] },
        });
      }
      if (path === '/api/v1/agent/observations:ingest') {
        return response(200, {
          results: [
            { status: 'ACCEPTED', reason_code: 'NONE' },
            { status: 'ACCEPTED', reason_code: 'NONE' },
          ],
        });
      }
      if (path.endsWith(':stop')) {
        return response(200, {
          result: { status: 'ACCEPTED', reason_code: 'NONE' },
          summary_job_id: 'summary-memory-1',
        });
      }
      if (init?.method === 'DELETE') {
        deleted.push(path);
        return response(204, null);
      }
      if (path === '/tools/forget') {
        return response(200, { result: { forgotten: true } });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const dependencies = baseDependencies(request);

    expect(await runAgentOpsCommand('demo', ['--json'], dependencies)).toBe(0);
    const result = JSON.parse(
      vi.mocked(dependencies.writeStdout).mock.calls[0]?.[0] as string,
    ) as { ok: boolean; injection: { summary_reused: boolean } };
    expect(result.ok).toBe(true);
    expect(result.injection.summary_reused).toBe(true);
    expect(request).toHaveBeenCalledWith('/api/v1/agent/sessions', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Use the established agent operations CLI workflow.'),
    }));
    expect(deleted).toEqual([
      '/api/v1/agent/sessions/memento-demo-fixed-id-2',
      '/api/v1/agent/sessions/memento-demo-fixed-id-1',
    ]);
    expect(request).toHaveBeenCalledWith('/tools/forget', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: 'summary-memory-1', hard: true, confirm: true }),
    }));
  });

  it('demo cleans up the first session when observation ingestion fails', async () => {
    const deleted: string[] = [];
    const request = vi.fn<AgentOpsRequest>(async (path, init) => {
      if (path === '/health') {
        return response(200, { status: 'healthy', version: '1.17.0', database: 'connected' });
      }
      if (path === '/api/v1/agent/capabilities') {
        return response(200, { contract_versions: [1], schema_ready: true });
      }
      if (path === '/api/v1/agent/sessions' && init?.method === 'POST') {
        return response(201, {
          result: { status: 'ACCEPTED', reason_code: 'NONE' },
          initial_injection: { status: 'empty', items: [] },
        });
      }
      if (path === '/api/v1/agent/observations:ingest') {
        return response(503, { reason_code: 'QUEUE_OVERFLOW' });
      }
      if (init?.method === 'DELETE') {
        deleted.push(path);
        return response(204, null);
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const dependencies = baseDependencies(request);

    expect(await runAgentOpsCommand('demo', ['--json'], dependencies)).toBe(1);
    expect(deleted).toEqual([
      '/api/v1/agent/sessions/memento-demo-fixed-id-1',
    ]);
  });

  it('provides stable guidance without echoing unknown details', () => {
    expect(reasonGuide('AUTH_FAILED')).toMatchObject({
      reason_code: 'AUTH_FAILED',
      category: 'auth',
    });
    expect(reasonGuide('UNRECOGNIZED')).toMatchObject({
      reason_code: 'UNRECOGNIZED',
      category: 'internal',
    });
  });

  it('prefers MEMENTO_API_KEY over ADMIN_API_KEY when both are set (#1241)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        status: 'healthy',
        version: '1.17.0',
        database: 'connected',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const dependencies = {
      resolveEndpoint: vi.fn().mockResolvedValue('http://127.0.0.1:8080'),
      now: () => new Date('2026-06-07T00:00:00.000Z'),
      randomId: () => 'fixed-id',
      writeStdout: vi.fn(),
      writeStderr: vi.fn(),
      env: {
        MEMENTO_API_KEY: 'memento-key',
        ADMIN_API_KEY: 'admin-key',
      },
    };

    await runAgentOpsCommand('doctor', ['--json'], dependencies);

    const authHeaders = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit).headers as Record<string, string>,
    );
    expect(authHeaders.some((headers) => headers.Authorization === 'Bearer memento-key')).toBe(true);
    expect(authHeaders.every((headers) => headers.Authorization !== 'Bearer admin-key')).toBe(true);

    vi.unstubAllGlobals();
  });

  it('does not request env MEMENTO_ENDPOINT when --endpoint is absent', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'memento-ops-empty-'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const code = await runAgentOpsCommand('doctor', ['--json'], {
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
        now: () => new Date('2026-06-07T00:00:00.000Z'),
        randomId: () => 'fixed-id',
        env: {
          MEMENTO_ENDPOINT: 'https://remote.example',
          MEMENTO_CONFIG_DIR: configDir,
          ADMIN_API_KEY: 'admin-key',
        },
      });

      expect(code).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('uses the loopback server-info port when MEMENTO_ENDPOINT is set', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'memento-ops-info-'));
    await writeFile(join(configDir, 'server.json'), JSON.stringify({
      port: 9,
      pid: 1,
      startedAt: '2026-06-07T00:00:00.000Z',
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        status: 'healthy',
        version: '1.17.0',
        database: 'connected',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await runAgentOpsCommand('doctor', ['--json'], {
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
        now: () => new Date('2026-06-07T00:00:00.000Z'),
        randomId: () => 'fixed-id',
        env: {
          MEMENTO_ENDPOINT: 'https://remote.example',
          MEMENTO_CONFIG_DIR: configDir,
          ADMIN_API_KEY: 'admin-key',
        },
      });

      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => url.startsWith('http://127.0.0.1:9/'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['http://127.0.0.1:9', 'Bearer admin-key'],
    ['http://localhost:9', 'Bearer admin-key'],
    ['http://[::1]:9', 'Bearer admin-key'],
    ['https://remote.example', undefined],
    ['https://localhost.example', undefined],
  ] as const)(
    'Authorization for %s is %s when only ADMIN_API_KEY is set',
    async (endpoint, authorization) => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({
          status: 'healthy',
          version: '1.17.0',
          database: 'connected',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        await runAgentOpsCommand('doctor', ['--json', '--endpoint', endpoint], {
          writeStdout: vi.fn(),
          writeStderr: vi.fn(),
          now: () => new Date('2026-06-07T00:00:00.000Z'),
          randomId: () => 'fixed-id',
          env: { ADMIN_API_KEY: 'admin-key' },
        });

        expect(fetchMock).toHaveBeenCalled();
        for (const [, init] of fetchMock.mock.calls) {
          const headers = (init as RequestInit).headers as Record<string, string>;
          expect(headers.Authorization).toBe(authorization);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('sends MEMENTO_API_KEY to an explicit remote endpoint and omits ADMIN_API_KEY', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        status: 'healthy',
        version: '1.17.0',
        database: 'connected',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await runAgentOpsCommand('doctor', ['--json', '--endpoint', 'https://remote.example'], {
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
        now: () => new Date('2026-06-07T00:00:00.000Z'),
        randomId: () => 'fixed-id',
        env: {
          MEMENTO_API_KEY: 'operator-key',
          ADMIN_API_KEY: 'admin-key',
        },
      });

      expect(fetchMock).toHaveBeenCalled();
      for (const [url, init] of fetchMock.mock.calls) {
        expect(String(url).startsWith('https://remote.example/')).toBe(true);
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer operator-key');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends --api-key to an explicit remote endpoint and omits ADMIN_API_KEY', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({
        status: 'healthy',
        version: '1.17.0',
        database: 'connected',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await runAgentOpsCommand(
        'doctor',
        ['--json', '--endpoint', 'https://remote.example', '--api-key', 'flag-key'],
        {
          writeStdout: vi.fn(),
          writeStderr: vi.fn(),
          now: () => new Date('2026-06-07T00:00:00.000Z'),
          randomId: () => 'fixed-id',
          env: { ADMIN_API_KEY: 'admin-key' },
        },
      );

      expect(fetchMock).toHaveBeenCalled();
      for (const [, init] of fetchMock.mock.calls) {
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer flag-key');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
