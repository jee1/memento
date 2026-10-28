import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runCursorHook } from './runner.js';

describe('Cursor hook runner', () => {
  it('returns additional_context for beforeSubmitPrompt payloads', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'cursor-directives-'));
    try {
      const recall = vi.fn().mockResolvedValue({
        items: [{ memory_id: 'c1', content: 'Prefer surgical diffs', final_score: 0.9 }],
      });
      const result = await runCursorHook({
        input: {
          conversation_id: 'conv-1',
          prompt: 'refactor the runner',
          cwd: '/repo',
        },
        directives: {
          config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
          recall,
          now: () => 1_700_000_000_000,
        },
      });

      const parsed = JSON.parse(result.stdout) as {
        additional_context: string;
        continue: boolean;
      };
      expect(parsed.continue).toBe(true);
      expect(parsed.additional_context).toContain('- Prefer surgical diffs');
      expect(parsed).not.toHaveProperty('hookSpecificOutput');
      expect(recall.mock.calls[0]?.[0]).toMatchObject({ query: 'refactor the runner' });
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it('returns empty stdout when directives are omitted', async () => {
    const result = await runCursorHook({
      input: { conversation_id: 'c', prompt: 'hi' },
    });
    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('ignores malformed input without failing closed', async () => {
    const result = await runCursorHook({ input: '{bad' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('invalid Cursor hook');
  });
});
