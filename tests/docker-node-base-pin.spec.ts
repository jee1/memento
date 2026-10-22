import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Node 24.22.1 is the 2026-10 security release.
 * A floating `node:24` tag satisfies a stale local cache of 24.22.0, so the
 * build must name the patched tag.
 */
const PATCHED = '24.22.1';

function nodeFromImages(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('FROM node:'))
    .map((line) => line.split(/\s+/)[1] ?? '');
}

describe('Docker Node base is the 2026-10 patched release', () => {
  it('builder and production name 24.22.1', () => {
    expect(nodeFromImages('Dockerfile')).toEqual([
      `node:${PATCHED}-alpine`,
      `node:${PATCHED}-slim`,
    ]);
  });

  it('log-issue-monitor names 24.22.1-alpine', () => {
    expect(nodeFromImages('docker/log-issue-monitor/Dockerfile')).toEqual([
      `node:${PATCHED}-alpine`,
    ]);
  });
});
