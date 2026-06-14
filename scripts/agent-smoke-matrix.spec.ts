import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runAgentSmokeMatrix,
  type AgentSmokeDependencies,
} from './agent-smoke-matrix.js';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'memento-agent-smoke-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function dependencies(root: string): AgentSmokeDependencies {
  return {
    root,
    now: () => new Date('2026-06-13T00:00:00.000Z'),
    platform: {
      os: 'linux',
      arch: 'x64',
      node: 'v24.11.0',
    },
    probeCommand: vi.fn(async (command, args) => {
      if (command === 'codex' && args[0] === '--version') {
        return { status: 0, stdout: 'codex-cli 0.137.0\n', stderr: '' };
      }
      if (command === 'codex') {
        return { status: 0, stdout: 'hooks stable true\n', stderr: '' };
      }
      if (command === 'claude' && args[0] === '--version') {
        return { status: 0, stdout: '2.1.153 (Claude Code)\n', stderr: '' };
      }
      return {
        status: 0,
        stdout: '--include-hook-events\n',
        stderr: '',
      };
    }),
  };
}

describe('agent smoke matrix', () => {
  it('verifies installed CLI compatibility, connect preservation, lifecycle, failures, and ops output', async () => {
    const root = await temporaryRoot();
    const report = await runAgentSmokeMatrix(dependencies(root));

    expect(report.ok).toBe(true);
    expect(report.environment).toMatchObject({
      os: 'linux',
      node: 'v24.11.0',
      codex: { status: 'pass', version: '0.137.0' },
      claude_code: { status: 'pass', version: '2.1.153' },
    });
    expect(report.adapters.codex.connect).toMatchObject({
      status: 'pass',
      preserved: true,
      backup_verified: true,
      reconnect_idempotent: true,
    });
    expect(report.adapters.claude_code.connect).toMatchObject({
      status: 'pass',
      preserved: true,
      backup_verified: true,
      reconnect_idempotent: true,
    });
    expect(report.adapters.codex.lifecycle).toHaveLength(5);
    expect(report.adapters.claude_code.lifecycle).toHaveLength(5);
    expect(report.adapters.codex.lifecycle.every(item => item.status === 'pass')).toBe(true);
    expect(report.adapters.claude_code.lifecycle.every(item => item.status === 'pass')).toBe(true);
    expect(report.adapters.codex.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenario: 'server_down', non_blocking: true }),
      expect.objectContaining({ scenario: 'auth_failure', non_blocking: true }),
      expect.objectContaining({ scenario: 'timeout', non_blocking: true }),
    ]));
    expect(report.operations.simulated).toMatchObject({
      doctor_human: 'pass',
      doctor_json: 'pass',
      status_human: 'pass',
      status_json: 'pass',
      demo_human: 'pass',
      demo_json: 'pass',
    });
    expect(report.operations.live).toMatchObject({
      status: 'skip',
      reason_code: 'LIVE_SERVER_NOT_CONFIGURED',
    });
  });

  it('preserves existing config bytes in backup and never duplicates hooks', async () => {
    const root = await temporaryRoot();
    const codexPath = join(root, 'codex-hooks.json');
    const claudePath = join(root, 'claude-settings.json');
    const codexOriginal = '{"state":{"trusted":true},"hooks":{"Other":[{"hooks":[{"type":"command","command":"other"}]}]}}\n';
    const claudeOriginal = '{"permissions":{"allow":["Read"]},"plugins":{"x":true}}\n';
    await writeFile(codexPath, codexOriginal, 'utf8');
    await writeFile(claudePath, claudeOriginal, 'utf8');

    const report = await runAgentSmokeMatrix({
      ...dependencies(root),
      configPaths: { codex: codexPath, claudeCode: claudePath },
    });

    const codex = JSON.parse(await readFile(codexPath, 'utf8')) as Record<string, unknown>;
    const claude = JSON.parse(await readFile(claudePath, 'utf8')) as Record<string, unknown>;
    expect(codex.state).toEqual({ trusted: true });
    expect(claude.permissions).toEqual({ allow: ['Read'] });
    expect(report.adapters.codex.connect.hook_count).toBe(5);
    expect(report.adapters.claude_code.connect.hook_count).toBe(5);
  });

  it('reports missing CLIs and live credentials as machine-readable skips', async () => {
    const root = await temporaryRoot();
    const deps = dependencies(root);
    deps.probeCommand = vi.fn(async () => ({
      status: null,
      stdout: '',
      stderr: 'not found',
    }));

    const report = await runAgentSmokeMatrix(deps);

    expect(report.ok).toBe(false);
    expect(report.environment.codex).toMatchObject({
      status: 'skip',
      reason_code: 'CLI_NOT_INSTALLED',
    });
    expect(report.environment.claude_code).toMatchObject({
      status: 'skip',
      reason_code: 'CLI_NOT_INSTALLED',
    });
    expect(report.operations.live.status).toBe('skip');
  });

  it('accepts controlled live-agent evidence only when all lifecycle events are automatic', async () => {
    const root = await temporaryRoot();
    const deps = dependencies(root);
    const baseProbe = deps.probeCommand!;
    deps.env = {
      MEMENTO_SMOKE_CODEX_COMMAND: '["controlled-codex"]',
      MEMENTO_SMOKE_CLAUDE_COMMAND: '["controlled-claude"]',
    };
    deps.probeCommand = vi.fn(async (command, args) => {
      if (command.startsWith('controlled-')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            ok: true,
            lifecycle_events: [
              'SessionStart',
              'UserPromptSubmit',
              'PostToolUse',
              'PreCompact',
              'Stop',
            ],
            manual_remember: false,
          })}\n`,
          stderr: '',
        };
      }
      return baseProbe(command, args);
    });

    const report = await runAgentSmokeMatrix(deps);

    expect(report.live_agent_sessions.codex.status).toBe('pass');
    expect(report.live_agent_sessions.claude_code.status).toBe('pass');
  });
});
