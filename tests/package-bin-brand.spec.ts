import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
