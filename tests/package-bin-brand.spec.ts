import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { planClaudeCodeSettings } from '../packages/memento-agent-integration/src/claude-code/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readBin(packageJsonPath: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    bin?: Record<string, string>;
  };
  if (!pkg.bin || typeof pkg.bin !== 'object') {
    throw new Error(`missing bin in ${packageJsonPath}`);
  }
  return pkg.bin;
}

describe('CLI bin brand (#766)', () => {
  it('root package.json keeps memento-mcp-server and drops memento-mcp alias', () => {
    const bin = readBin(join(root, 'package.json'));
    expect(bin['memento-mcp-server']).toBe('./dist/server/index.js');
    expect(bin).not.toHaveProperty('memento-mcp');
  });

  it('memento-server package.json keeps memento-mcp-server and drops memento-mcp alias', () => {
    const bin = readBin(join(root, 'packages/memento-server/package.json'));
    expect(bin['memento-mcp-server']).toBe('./dist/server/index.js');
    expect(bin).not.toHaveProperty('memento-mcp');
  });

  it('root package.json publishes the bin that connect claude-code registers (#1492)', () => {
    const { settings } = planClaudeCodeSettings({}, { settingsPath: 'settings.json' });
    const command = settings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? '';
    const binName = command.split(' ')[0] ?? '';
    const serverBin = readBin(join(root, 'packages/memento-server/package.json'));

    expect(binName).toBe('memento');
    expect(readBin(join(root, 'package.json'))[binName]).toBe(serverBin[binName]);
  });
});
