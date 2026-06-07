import { describe, expect, it, vi } from 'vitest';

import { runCodexHook } from './runner.js';

describe('Codex hook runner', () => {
  it('captures and drains without stdout context', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true });
    const result = await runCodexHook({
      input: {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-1',
        cwd: '/repo',
        prompt: 'remember this',
      },
      transport,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.capture.status).toBe('ACCEPTED');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('isolates malformed input and server failure', async () => {
    const malformed = await runCodexHook({ input: '{bad', transport: vi.fn() });
    const failed = await runCodexHook({
      input: {
        hook_event_name: 'Stop',
        session_id: 'session-1',
        cwd: '/repo',
        outcome: 'completed',
      },
      transport: vi.fn().mockRejectedValue(new Error('secret server failure')),
      maxRetries: 0,
    });

    expect(malformed.exitCode).toBe(0);
    expect(malformed.capture.status).toBe('INVALID');
    expect(failed.exitCode).toBe(0);
    expect(failed.dispatch?.status).toBe('DEGRADED');
    expect(failed.stderr).not.toContain('secret server failure');
  });
});
