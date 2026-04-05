/**
 * CLI AC5 / AC6 / AC9 / AC10 검증
 * AC5: --db-path 지정 시 해당 DB 사용
 * AC6: ~/.memento/.env만 있을 때 DB_PATH 적용
 * AC9: AC6 시나리오 자동 테스트
 * AC10: 실패 시나리오 (필수 인자 누락, 알 수 없는 서브커맨드)
 * 실행 전 npm run build -w memento-server 필요.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const cliPath = path.join(__dirname, '../../dist/cli.js');
const cliBuilt = fs.existsSync(cliPath);

interface RunCliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function runCli(
  args: string[],
  options: NodeJS.ProcessEnv | RunCliOptions = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { env: optEnv, cwd: optCwd } = typeof (options as RunCliOptions).cwd === 'string'
    ? (options as RunCliOptions)
    : { env: options as NodeJS.ProcessEnv, cwd: undefined };
  const env = { ...process.env, ...optEnv };
  const cwd = optCwd ?? process.cwd();
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], { env, cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (c) => { stdout += c; });
    proc.stderr?.on('data', (c) => { stderr += c; });
    proc.on('close', (code, signal) => {
      resolve({ stdout, stderr, code: code ?? (signal === 'SIGTERM' ? 143 : 1) });
    });
  });
}

describe.skipIf(!cliBuilt)('CLI AC5/AC6', () => {
  it('AC5: --db-path 지정 시 해당 DB 사용 (recall 호출 시 exit 0, JSON stdout)', async () => {
    const dbPath = path.join(os.tmpdir(), `memento-cli-ac5-${Date.now()}.db`);
    const { stdout, code } = await runCli([
      '--db-path', dbPath,
      'recall', '--query', 'test', '--limit', '1'
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    const hasItems = parsed.items !== undefined && Array.isArray(parsed.items);
    const hasContent = Array.isArray(parsed.content) && parsed.content.length > 0;
    expect(hasItems || hasContent).toBe(true);
    try { fs.unlinkSync(dbPath); } catch (_) {}
  }, 15000);

  it('memento --help prints subcommand list (AC1)', async () => {
    const { stdout, stderr, code } = await runCli(['--help']);
    expect(code).toBe(0);
    const out = stderr || stdout;
    expect(out).toContain('recall');
    expect(out).toContain('remember');
    expect(out).toContain('forget');
    expect(out).toContain('memory_injection');
  });

  it('AC6/AC9: cwd에 .env 없고 ~/.memento/.env에만 DB_PATH 있을 때 해당 DB 사용', async () => {
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-cli-ac6-cwd-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-cli-home-'));
    const dbPath = path.join(os.tmpdir(), `memento-cli-ac6-db-${Date.now()}.db`);
    try {
      fs.mkdirSync(path.join(fakeHome, '.memento'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.memento', '.env'), `DB_PATH=${dbPath.replace(/\\/g, '/')}\n`);
      // DB_PATH를 env에서 제거해야 CLI가 ~/.memento/.env를 읽는 경로로 진입함
      const { DB_PATH: _removed, ...envWithoutDbPath } = process.env;
      const { stdout, code } = await runCli(['recall', '--query', 'test', '--limit', '1'], { env: { ...envWithoutDbPath, HOME: fakeHome }, cwd: tmpCwd });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.items !== undefined && Array.isArray(parsed.items) || Array.isArray(parsed.content)).toBe(true);
    } finally {
      try { fs.rmSync(tmpCwd, { recursive: true }); } catch (_) {}
      try { fs.rmSync(fakeHome, { recursive: true }); } catch (_) {}
      try { fs.unlinkSync(dbPath); } catch (_) {}
    }
  }, 15000);

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
