import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runClaudeCodeConnect } from './claude-code-connect.js';

describe('memento connect claude-code', () => {
  it('prints a compatible dry-run without writing settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memento-connect-claude-'));
    const settingsPath = join(root, 'settings.json');
    await writeFile(settingsPath, '{"permissions":{"allow":["Read"]}}\n', 'utf8');
    const output: string[] = [];

    const code = await runClaudeCodeConnect(
      ['--dry-run', '--settings-path', settingsPath],
      {
        probe: () => ({
          versionOutput: '2.1.153 (Claude Code)',
          helpOutput: '--include-hook-events',
        }),
        write: message => output.push(message),
      },
    );

    expect(code).toBe(0);
    expect(output.join('')).toContain('"compatible":true');
    expect(output.join('')).toContain('"changed":true');
    expect(JSON.parse(await readFile(settingsPath, 'utf8')))
      .toEqual({ permissions: { allow: ['Read'] } });
  });

  it('applies once and reports unchanged on reconnect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memento-connect-claude-'));
    const settingsPath = join(root, 'settings.json');
    const write = vi.fn();
    const dependencies = {
      probe: () => ({
        versionOutput: '2.1.153 (Claude Code)',
        helpOutput: '--include-hook-events',
      }),
      write,
    };

    expect(await runClaudeCodeConnect(
      ['--settings-path', settingsPath],
      dependencies,
    )).toBe(0);
    expect(await runClaudeCodeConnect(
      ['--settings-path', settingsPath],
      dependencies,
    )).toBe(0);

    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'PostToolUse',
      'PreCompact',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
    expect(write.mock.calls.at(-1)?.[0]).toContain('"changed":false');
  });
});
