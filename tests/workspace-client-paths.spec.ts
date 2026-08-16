import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
};

function readJson(relativePath: string): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf-8')) as PackageJson;
}

describe('workspace client path contracts', () => {
  it('root client scripts should target the official @jee1/memento-client workspace', () => {
    const root = readJson('package.json');

    expect(root.scripts?.['build:client']).toBe('npm run build -w @jee1/memento-client');
    expect(root.scripts?.['dev:client']).toBe('npm run dev -w @jee1/memento-client');
    expect(root.scripts?.['clean:client']).toBe('npm run clean -w @jee1/memento-client');
    expect(root.scripts?.['publish:client']).toBe('npm publish --workspace @jee1/memento-client');
  });

  it('legacy packages/mcp-client should not claim the official package name', () => {
    const legacy = readJson('packages/mcp-client/package.json');

    expect(legacy.name).toBe('@memento/client-legacy');
    expect(legacy.private).toBe(true);
  });
});
