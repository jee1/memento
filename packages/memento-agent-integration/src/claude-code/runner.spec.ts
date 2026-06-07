import { describe, expect, it, vi } from 'vitest';

import { runClaudeCodeHook } from './runner.js';

describe('Claude Code hook runner', () => {
  it('captures a fixture and drains without writing context', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true });
    const result = await runClaudeCodeHook({
      input: {
        session_id: 'session-1',
        cwd: '/workspace/repo',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'remember this',
      },
      transport,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.capture.status).toBe('ACCEPTED');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns exit zero for malformed input and transport failure', async () => {
    const malformed = await runClaudeCodeHook({
      input: '{bad json',
      transport: vi.fn(),
    });
    const failed = await runClaudeCodeHook({
      input: {
        session_id: 'session-1',
        cwd: '/workspace/repo',
        hook_event_name: 'Stop',
        stop_hook_active: false,
        last_assistant_message: 'done',
      },
      transport: vi.fn().mockRejectedValue(new Error('server down')),
      timeoutMs: 10,
      maxRetries: 0,
    });

    expect(malformed.exitCode).toBe(0);
    expect(malformed.capture.status).toBe('INVALID');
    expect(failed.exitCode).toBe(0);
    expect(failed.dispatch?.status).toBe('DEGRADED');
    expect(failed.stderr).not.toContain('server down');
  });
});
