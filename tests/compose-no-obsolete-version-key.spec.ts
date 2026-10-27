import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COMPOSE_VERSION_PATTERN = /^\s*version\s*:/;

function listComposeFiles(): string[] {
  const root = process.cwd();
  const paths: string[] = [];

  for (const name of readdirSync(root)) {
    if (name.startsWith('docker-compose') && name.endsWith('.yml')) {
      paths.push(name);
    }
  }

  const dockerDir = join(root, 'docker');
  if (existsSync(dockerDir)) {
    for (const name of readdirSync(dockerDir)) {
      if (name.startsWith('docker-compose') && name.endsWith('.yml')) {
        paths.push(join('docker', name));
      }
    }
  }

  const orchestration = 'apps/multi-agent-orchestration/docker-compose.yml';
  if (existsSync(join(root, orchestration))) {
    paths.push(orchestration);
  }

  return paths.sort();
}

function findVersionKeyLines(relativePath: string): string[] {
  const source = readFileSync(join(process.cwd(), relativePath), 'utf-8');
  return source
    .split('\n')
    .map((line, index) => ({ lineNo: index + 1, line: line.trimEnd() }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return false;
      return COMPOSE_VERSION_PATTERN.test(line);
    })
    .map(({ lineNo, line }) => `${relativePath}:${lineNo}: ${line.trim()}`);
}

describe('#1491: compose 파일에 obsolete version 키가 없다', () => {
  it('tracks every docker-compose*.yml under repo root, docker/, and orchestration app', () => {
    const paths = listComposeFiles();
    expect(paths).toContain('docker-compose.yml');
    expect(paths).toContain('docker-compose.base.yml');
    expect(paths).toContain('docker/docker-compose.prod.yml');
    expect(paths.length).toBeGreaterThanOrEqual(10);
  });

  it('does not declare top-level version (docker compose v2 ignores it and warns)', () => {
    const violations = listComposeFiles().flatMap(findVersionKeyLines);
    expect(violations).toEqual([]);
  });
});
