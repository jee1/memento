import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyCodexHooks, planCodexHooks } from './settings.js';

describe('Codex hooks connection', () => {
  const existing = {
    state: { trusted: true },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'existing' }] }],
    },
  };

  it('preserves settings and adds five handlers once', () => {
    const first = planCodexHooks(existing, { hooksPath: '/tmp/hooks.json' });
    const second = planCodexHooks(first.settings, { hooksPath: '/tmp/hooks.json' });

    expect(first.changed).toBe(true);
    expect(first.addedEvents).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PostToolUse',
      'PreCompact',
      'Stop',
    ]);
    expect(first.settings.state).toEqual(existing.state);
    expect(first.settings.hooks?.SessionStart?.[0]).toEqual(existing.hooks.SessionStart[0]);
    expect(second.changed).toBe(false);
  });

  it('backs up and atomically writes only when changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memento-codex-hooks-'));
    const hooksPath = join(root, 'hooks.json');
    const original = `${JSON.stringify(existing, null, 2)}\n`;
    await writeFile(hooksPath, original, 'utf8');

    const first = await applyCodexHooks({
      hooksPath,
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });
    const second = await applyCodexHooks({
      hooksPath,
      now: () => new Date('2026-06-07T00:00:01.000Z'),
    });

    expect(await readFile(first.backupPath!, 'utf8')).toBe(original);
    expect(first.diff).toContain('+ PostToolUse');
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeUndefined();
  });
});
