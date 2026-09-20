import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENV_TEMPLATE_PATHS = [
  'env.example',
  '.env.example',
  '.env.test',
  'services/agent/env.example',
] as const;

const ASSIGNMENT_PATTERN = /^\s*(?:export\s+)?MCP_SERVER_(?:NAME|VERSION)\s*=/;

function readExistingEnvTemplates(): Array<{ path: string; source: string }> {
  const root = process.cwd();
  const found = ENV_TEMPLATE_PATHS.filter((relativePath) =>
    existsSync(join(root, relativePath)),
  ).map((relativePath) => ({
    path: relativePath,
    source: readFileSync(join(root, relativePath), 'utf-8'),
  }));

  if (found.length === 0) {
    throw new Error(`No env templates found among: ${ENV_TEMPLATE_PATHS.join(', ')}`);
  }

  return found;
}

function findPinnedVersionLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return false;
      return ASSIGNMENT_PATTERN.test(line);
    });
}

describe('#1077: env 템플릿이 MCP_SERVER_NAME·MCP_SERVER_VERSION 을 고정하지 않는다', () => {
  it('tracks at least one env template file', () => {
    const templates = readExistingEnvTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.map((entry) => entry.path)).toContain('env.example');
  });

  it('does not assign MCP_SERVER_NAME or MCP_SERVER_VERSION in any env template', () => {
    const violations = readExistingEnvTemplates().flatMap(({ path, source }) =>
      findPinnedVersionLines(source).map((line) => `${path}: ${line}`),
    );

    expect(violations).toEqual([]);
  });
});
