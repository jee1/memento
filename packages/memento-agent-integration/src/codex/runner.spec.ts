import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    expect(result.capture?.status).toBe('ACCEPTED');
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
    expect(malformed.capture?.status).toBe('INVALID');
    expect(failed.exitCode).toBe(0);
    expect(failed.dispatch?.status).toBe('DEGRADED');
    expect(failed.stderr).not.toContain('secret server failure');
  });

  it('returns directive context on stdout while still dispatching capture', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'codex-directives-'));
    try {
      const transport = vi.fn().mockResolvedValue({ ok: true });
      const recall = vi.fn().mockResolvedValue({
        items: [{ memory_id: 'c1', content: 'Run tests in isolation', final_score: 0.8 }],
      });
      const result = await runCodexHook({
        input: {
          hook_event_name: 'UserPromptSubmit',
          session_id: 'session-1',
          cwd: '/repo',
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
      expect(result.capture?.status).toBe('ACCEPTED');
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it('preserves directive injection when capture is disabled', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'codex-directives-nocap-'));
    try {
      const transport = vi.fn().mockResolvedValue({ ok: true });
      const recall = vi.fn().mockResolvedValue({
        items: [{ memory_id: 'c1', content: 'Directive only', final_score: 0.8 }],
      });
      const result = await runCodexHook({
        input: {
          hook_event_name: 'UserPromptSubmit',
          session_id: 'session-1',
          cwd: '/repo',
          prompt: 'test prompt',
        },
        transport,
        env: { MEMENTO_CAPTURE: '0' },
        directives: {
          config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
          recall,
          now: () => Date.now(),
        },
      });

      const parsed = JSON.parse(result.stdout) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.additionalContext).toContain('- Directive only');
      expect(result.capture).toBeUndefined();
      expect(transport).not.toHaveBeenCalled();
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});
