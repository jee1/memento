import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENV_TEMPLATE_PATHS = [
  'env.example',
  '.env.example',
  '.env.test',
  'services/agent/env.example',
] as const;

const ENV_ASSIGNMENT_PATTERN = /^\s*(?:export\s+)?MCP_SERVER_(?:NAME|VERSION)\s*=/;
const COMPOSE_KEY_PATTERN = /^\s*MCP_SERVER_(?:NAME|VERSION)\s*:/;

type PinnedLine = { lineNo: number; line: string };

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

function readRootComposeFiles(): Array<{ path: string; source: string }> {
  const root = process.cwd();
  return readdirSync(root)
    .filter((name) => name.startsWith('docker-compose') && name.endsWith('.yml'))
    .sort()
    .map((name) => ({
      path: name,
      source: readFileSync(join(root, name), 'utf-8'),
    }));
}

function findPinnedLines(source: string, pattern: RegExp): PinnedLine[] {
  return source
    .split('\n')
    .map((line, index) => ({ lineNo: index + 1, line: line.trimEnd() }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return false;
      return pattern.test(line);
    });
}

function formatViolations(
  files: Array<{ path: string; source: string }>,
  pattern: RegExp,
): string[] {
  return files.flatMap(({ path, source }) =>
    findPinnedLines(source, pattern).map(
      ({ lineNo, line }) => `${path}:${lineNo}: ${line}`,
    ),
  );
}

describe('#1077: env 템플릿·루트 compose가 MCP_SERVER_NAME·MCP_SERVER_VERSION 을 고정하지 않는다', () => {
  it('tracks at least one env template file and root docker-compose*.yml', () => {
    const templates = readExistingEnvTemplates();
    const composeFiles = readRootComposeFiles();

    expect(templates.length).toBeGreaterThan(0);
    expect(templates.map((entry) => entry.path)).toContain('env.example');
    expect(composeFiles.length).toBeGreaterThan(0);
    expect(composeFiles.map((entry) => entry.path)).toContain('docker-compose.base.yml');
  });

  it('does not assign MCP_SERVER_NAME or MCP_SERVER_VERSION in env templates or root docker-compose*.yml', () => {
    const violations = [
      ...formatViolations(readExistingEnvTemplates(), ENV_ASSIGNMENT_PATTERN),
      ...formatViolations(readRootComposeFiles(), COMPOSE_KEY_PATTERN),
    ];

    expect(violations).toEqual([]);
  });
});
