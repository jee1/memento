import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

function getRepoRoot(): string {
  // __dirname = .../packages/memento-server/src/server → repo root is 4 levels up
  return path.resolve(__dirname, '../../../..');
}

/** Parse KEY=... lines (ignores blank lines and # comments). */
function collectEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    keys.push(trimmed.slice(0, eq).trim());
  }
  return keys;
}

function expectNoDuplicateKeys(label: string, content: string): void {
  const keys = collectEnvKeys(content);
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) dups.push(k);
    seen.add(k);
  }
  expect(dups, `${label}: duplicate keys`).toEqual([]);
}

describe('environment templates consistency', () => {
  it('includes required security and agent sections in root env.example', () => {
    const repoRoot = getRepoRoot();
    const envExamplePath = path.join(repoRoot, 'env.example');
    const content = readFileSync(envExamplePath, 'utf-8');

    expect(content).toContain('[REQUIRED in production]');
    expect(content).toContain('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN');
    expect(content).toContain('MEMENTO_AGENT_LLM_PROVIDER');
    expect(content).toContain('MEMENTO_AGENT_OLLAMA_MODEL');
    expect(content).toContain('MEMENTO_BASE_URL=');
  });

  it('provides tracked agent template file', () => {
    const repoRoot = getRepoRoot();
    const agentTemplatePath = path.join(repoRoot, 'services/agent/env.example');

    expect(existsSync(agentTemplatePath)).toBe(true);

    const content = readFileSync(agentTemplatePath, 'utf-8');
    expect(content).toContain('AGENT_LLM_PROVIDER=');
    expect(content).toContain('AGENT_OLLAMA_MODEL=');
    expect(content).toContain('MEMENTO_BASE_URL=');
  });

  it('has no duplicate variable names in env templates', () => {
    const repoRoot = getRepoRoot();
    const rootExample = readFileSync(path.join(repoRoot, 'env.example'), 'utf-8');
    const agentExample = readFileSync(path.join(repoRoot, 'services/agent/env.example'), 'utf-8');
    expectNoDuplicateKeys('env.example', rootExample);
    expectNoDuplicateKeys('services/agent/env.example', agentExample);
  });
});
