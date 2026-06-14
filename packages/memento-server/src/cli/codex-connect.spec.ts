import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runCodexConnect } from './codex-connect.js';

describe('memento connect codex', () => {
  it('dry-runs without changing hooks.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memento-connect-codex-'));
    const hooksPath = join(root, 'hooks.json');
    await writeFile(hooksPath, '{"state":{"preserve":true}}\n', 'utf8');
    const output: string[] = [];

    expect(await runCodexConnect(['--dry-run', '--hooks-path', hooksPath], {
      probe: () => ({
        versionOutput: 'codex-cli 0.139.0',
        featuresOutput: 'hooks stable true',
      }),
      write: message => output.push(message),
    })).toBe(0);
    expect(output.join('')).toContain('"compatible":true');
    expect(output.join('')).toContain('"trustApproval":"unverified"');
    expect(output.join('')).toContain('"hooksFeature":{"stage":"stable","enabled":true}');
    expect(output.join('')).toContain('+ PostToolUse');
    expect(output.join('')).toContain('open /hooks');
    expect(JSON.parse(await readFile(hooksPath, 'utf8')))
      .toEqual({ state: { preserve: true } });
  });

  it('applies once and reports unchanged on reconnect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memento-connect-codex-'));
    const hooksPath = join(root, 'hooks.json');
    const write = vi.fn();
    const dependencies = {
      probe: () => ({
        versionOutput: 'codex-cli 0.139.0',
        featuresOutput: 'hooks stable true',
      }),
      write,
    };

    expect(await runCodexConnect(['--hooks-path', hooksPath], dependencies)).toBe(0);
    expect(await runCodexConnect(['--hooks-path', hooksPath], dependencies)).toBe(0);
    expect(write.mock.calls.at(-1)?.[0]).toContain('"changed":false');
  });
});
