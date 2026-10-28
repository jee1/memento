import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runClaudeCodeHook } from './claude-code/runner.js';
import { runCodexHook } from './codex/runner.js';
import { runCursorHook } from './cursor/runner.js';

async function readLogCases(logDir: string): Promise<string[][]> {
  const files = (await readdir(logDir)).filter((name) => name.endsWith('.jsonl')).sort();
  const ids: string[][] = [];
  for (const file of files) {
    const text = await readFile(join(logDir, file), 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as { cases?: Array<{ id: string }> };
      if (row.cases) ids.push(row.cases.map((c) => c.id));
    }
  }
  return ids;
}

describe('directive host contract (#1496)', () => {
  it('Claude Code, Codex, and Cursor share selection and log ids; only stdout envelopes differ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'directive-hosts-'));
    try {
      const recall = vi.fn().mockResolvedValue({
        items: [
          { memory_id: 'c-high', content: 'Use poteto-mode for every coding task', final_score: 0.91 },
          { memory_id: 'c-low', content: 'noise', final_score: 0.1 },
        ],
      });
      const now = () => 1_700_000_000_123;
      const transport = vi.fn().mockResolvedValue({ ok: true });
      const hosts = [
        {
          name: 'claude',
          logDir: join(root, 'claude'),
          run: (logDir: string) => runClaudeCodeHook({
            input: {
              session_id: 'session-shared',
              cwd: '/workspace',
              hook_event_name: 'UserPromptSubmit',
              prompt: 'ship the feature',
            },
            transport,
            directives: {
              config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
              recall,
              now,
            },
          }),
          contextOf: (stdout: string) => (
            JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }
          ).hookSpecificOutput.additionalContext,
        },
        {
          name: 'codex',
          logDir: join(root, 'codex'),
          run: (logDir: string) => runCodexHook({
            input: {
              session_id: 'session-shared',
              cwd: '/workspace',
              hook_event_name: 'UserPromptSubmit',
              prompt: 'ship the feature',
            },
            transport,
            directives: {
              config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
              recall,
              now,
            },
          }),
          contextOf: (stdout: string) => (
            JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }
          ).hookSpecificOutput.additionalContext,
        },
        {
          name: 'cursor',
          logDir: join(root, 'cursor'),
          run: (logDir: string) => runCursorHook({
            input: {
              conversation_id: 'session-shared',
              cwd: '/workspace',
              prompt: 'ship the feature',
            },
            directives: {
              config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
              recall,
              now,
            },
          }),
          contextOf: (stdout: string) => (
            JSON.parse(stdout) as { additional_context: string }
          ).additional_context,
        },
      ] as const;

      const contexts: string[] = [];
      const caseLists: string[][] = [];
      for (const host of hosts) {
        await rm(host.logDir, { recursive: true, force: true });
        const { mkdir } = await import('node:fs/promises');
        await mkdir(host.logDir, { recursive: true });
        const result = await host.run(host.logDir);
        expect(result.exitCode).toBe(0);
        contexts.push(host.contextOf(result.stdout));
        caseLists.push(...await readLogCases(host.logDir));
      }

      expect(new Set(contexts).size).toBe(1);
      expect(contexts[0]).toContain('- Use poteto-mode for every coding task');
      expect(contexts[0]).not.toContain('noise');
      expect(caseLists).toEqual([['c-high'], ['c-high'], ['c-high']]);
      expect(recall).toHaveBeenCalledTimes(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
