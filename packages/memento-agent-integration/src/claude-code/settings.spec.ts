import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyClaudeCodeSettings,
  planClaudeCodeSettings,
} from './settings.js';

describe('Claude Code settings connection', () => {
  const existing = {
    permissions: { allow: ['Read'] },
    hooks: {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'existing-session-hook' }],
      }],
      UserPromptSubmit: [{
        hooks: [{ type: 'command', command: 'existing-prompt-hook' }],
      }],
    },
  };

  it('preserves existing settings and adds five lifecycle handlers once', () => {
    const first = planClaudeCodeSettings(existing, {
      settingsPath: '/tmp/settings.json',
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });
    const second = planClaudeCodeSettings(first.settings, {
      settingsPath: '/tmp/settings.json',
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });

    expect(first.changed).toBe(true);
    expect(first.addedEvents).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PostToolUse',
      'PreCompact',
      'Stop',
    ]);
    expect(first.settings.permissions).toEqual(existing.permissions);
    expect(first.diff).toContain('+ PostToolUse');
    expect(first.settings.hooks?.SessionStart?.[0]).toEqual(
      existing.hooks.SessionStart[0],
    );
    expect(second.changed).toBe(false);
    expect(second.addedEvents).toEqual([]);

    for (const event of first.addedEvents) {
      const groups = first.settings.hooks?.[event] ?? [];
      const mementoHandlers = groups.flatMap(group => group.hooks)
        .filter(handler =>
          handler.command === 'memento hook claude-code'
        );
      expect(mementoHandlers).toHaveLength(1);
    }
  });

  it('backs up and atomically writes only when changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memento-claude-settings-'));
    const settingsPath = join(root, 'settings.json');
    await writeFile(settingsPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');

    const first = await applyClaudeCodeSettings({
      settingsPath,
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });
    const afterFirst = await readFile(settingsPath, 'utf8');
    const second = await applyClaudeCodeSettings({
      settingsPath,
      now: () => new Date('2026-06-07T00:00:01.000Z'),
    });

    expect(first.changed).toBe(true);
    expect(first.backupPath).toBeDefined();
    expect(await readFile(first.backupPath!, 'utf8'))
      .toBe(`${JSON.stringify(existing, null, 2)}\n`);
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeUndefined();
    expect(await readFile(settingsPath, 'utf8')).toBe(afterFirst);
  });
});
