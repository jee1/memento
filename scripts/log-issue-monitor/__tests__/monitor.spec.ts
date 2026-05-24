import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMonitorCycle } from '../monitor.js';
import type { MonitorConfig } from '../types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memento-monitor-cycle-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function config(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    containerName: 'memento-mcp-server',
    logsRoot: dir,
    stateDir: join(dir, 'state'),
    githubRepository: 'owner/repo',
    intervalSeconds: 30,
    warnThreshold: 3,
    warnWindowSeconds: 600,
    dryRun: true,
    labels: ['bug', 'memento-log-monitor'],
    maxExcerptBytes: 6000,
    includeStack: true,
    ...overrides,
  };
}

describe('runMonitorCycle', () => {
  it('records detected app log errors locally in dry-run mode', async () => {
    await runMonitorCycle(config(), {
      readDockerLogs: async () => ['2026-05-02T00:00:00.000Z | ERROR | DB failed | {"component":"db"}'],
      readJsonlFiles: async () => ({ lines: [], cursors: {} }),
      githubClient: undefined,
      onMonitorError: vi.fn(),
    });

    const state = await import('../state-store.js').then(module => module.loadState(join(dir, 'state')));
    const fingerprints = Object.values(state.fingerprints);

    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0].occurrenceCount).toBe(1);
    expect(fingerprints[0].status).toBe('local_only');
  });

  it('creates a GitHub issue when a promotable fingerprint is detected', async () => {
    const githubClient = {
      findOpenIssueByFingerprint: vi.fn().mockResolvedValue(undefined),
      createIssue: vi.fn().mockResolvedValue({ number: 11, state: 'open' }),
      getIssue: vi.fn(),
      updateIssue: vi.fn(),
    };

    await runMonitorCycle(config({ dryRun: false, githubToken: 'ghp_token' }), {
      readDockerLogs: async () => ['2026-05-02T00:00:00.000Z | ERROR | DB failed | {"component":"db"}'],
      readJsonlFiles: async () => ({ lines: [], cursors: {} }),
      githubClient: githubClient as never,
      onMonitorError: vi.fn(),
    });

    const state = await import('../state-store.js').then(module => module.loadState(join(dir, 'state')));
    const fingerprints = Object.values(state.fingerprints);

    expect(githubClient.createIssue).toHaveBeenCalledOnce();
    expect(fingerprints[0].githubIssueNumber).toBe(11);
    expect(fingerprints[0].status).toBe('opened');
  });
});
