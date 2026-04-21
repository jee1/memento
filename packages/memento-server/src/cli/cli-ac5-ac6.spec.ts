/**
 * CLI AC5 / AC6 / AC9 / AC10 검증
 * AC5: --db-path 지정 시 해당 DB 사용
 * AC6: ~/.memento/.env만 있을 때 DB_PATH 적용
 * AC9: AC6 시나리오 자동 테스트
 * AC10: 실패 시나리오 (필수 인자 누락, 알 수 없는 서브커맨드)
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cliPath = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

beforeAll(() => {
  const buildCore = spawnSync(
    npmCommand,
    ['run', 'build', '-w', '@memento/core'],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    },
  );
  const buildCoreOutput = `${buildCore.stdout ?? ''}${buildCore.stderr ?? ''}`;
  expect(buildCore.status, buildCoreOutput).toBe(0);

  const buildServer = spawnSync(
    npmCommand,
    ['run', 'build', '-w', 'memento-server'],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    },
  );
  const buildOutput = `${buildCoreOutput}${buildServer.stdout ?? ''}${buildServer.stderr ?? ''}`;

  expect(buildServer.status, buildOutput).toBe(0);
  expect(fs.existsSync(cliPath)).toBe(true);

  const probe = spawnSync(
    process.execPath,
    [cliPath, '--help'],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    },
  );
  const probeOutput = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;

  expect(probe.status, `${buildOutput}
${probeOutput}`).toBe(0);
  expect(probeOutput).toContain('recall');
}, 60_000);

interface RunCliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function runCli(
  args: string[],
  options: NodeJS.ProcessEnv | RunCliOptions = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { env: optEnv, cwd: optCwd } = typeof (options as RunCliOptions).cwd === 'string'
    ? (options as RunCliOptions)
    : { env: options as NodeJS.ProcessEnv, cwd: undefined };
  const env = optEnv !== undefined ? optEnv : { ...process.env };
  const cwd = optCwd ?? process.cwd();

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('close', (code, signal) => {
      resolve({ stdout, stderr, code: code ?? (signal === 'SIGTERM' ? 143 : 1) });
    });
  });
}

describe('CLI AC5/AC6', () => {
  it('AC5: --db-path 지정 시 deprecated 경고 출력 후 exit 1 (서버 미실행)', async () => {
    const dbPath = path.join(os.tmpdir(), `memento-cli-ac5-${Date.now()}.db`);
    const { stderr, code } = await runCli([
      '--db-path', dbPath,
      'recall', '--query', 'test', '--limit', '1',
    ]);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/deprecated/);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore cleanup failures
    }
  }, 15_000);

  it('memento --help prints subcommand list (AC1)', async () => {
    const { stdout, stderr, code } = await runCli(['--help']);
    const output = stderr || stdout;

    expect(code).toBe(0);
    expect(output).toContain('recall');
    expect(output).toContain('remember');
    expect(output).toContain('forget');
    expect(output).toContain('memory_injection');
  });

  it('AC6/AC9: 서버 미실행 시 exit 1 및 서버 실행 안내 메시지 출력', async () => {
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-cli-ac6-cwd-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-cli-home-'));

    try {
      fs.mkdirSync(path.join(fakeHome, '.memento'), { recursive: true });
      const { DB_PATH: _omit, ...baseEnv } = process.env;
      const { stderr, code } = await runCli(
        ['recall', '--query', 'test', '--limit', '1'],
        { env: { ...baseEnv, HOME: fakeHome }, cwd: tmpCwd },
      );

      expect(code).not.toBe(0);
      expect(stderr).toMatch(/서버/);
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  }, 15_000);

  it('AC10(1): recall without --query → exit 1, stderr에 requires --query 등', async () => {
    const { stderr, code } = await runCli(['recall', '--limit', '1']);

    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/query|requires/);
  });

  it('AC10(2): 알 수 없는 서브커맨드 → exit 1', async () => {
    const { stderr, code } = await runCli(['unknown_subcommand']);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/unknown|Unknown|--help/);
  });
});
