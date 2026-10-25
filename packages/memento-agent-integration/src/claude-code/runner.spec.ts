import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('returns directive context on stdout while still dispatching capture', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'runner-directives-'));
    try {
      const transport = vi.fn().mockResolvedValue({ ok: true });
      const recall = vi.fn().mockResolvedValue({
        items: [{ memory_id: 'c1', content: 'Run tests in isolation' }],
      });
      const result = await runClaudeCodeHook({
        input: {
          session_id: 'session-1',
          cwd: '/workspace/repo',
          hook_event_name: 'UserPromptSubmit',
          prompt: 'flaky tests again',
        },
        transport,
        directives: {
          config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
          recall,
          now: () => Date.now(),
        },
      });

      const parsed = JSON.parse(result.stdout) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.additionalContext).toContain('- Run tests in isolation');
      expect(recall.mock.calls[0]?.[0]).toMatchObject({ query: 'flaky tests again' });
      expect(result.capture.status).toBe('ACCEPTED');
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});
