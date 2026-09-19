/**
 * verify-bin.js 런타임 검증 (#1034)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const VERIFY_BIN_SCRIPT = join(process.cwd(), 'scripts/verify-bin.js');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

type FakeProjectOptions = {
  bin: Record<string, string>;
  entries: Record<string, string>;
};

function createFakeProject(options: FakeProjectOptions): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-bin-fake-'));
  tempDirs.push(root);

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'verify-bin-fake', version: '0.0.0', bin: options.bin }, null, 2)
  );

  for (const [relPath, content] of Object.entries(options.entries)) {
    const fullPath = join(root, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  return root;
}

function runVerifyBin(root: string, extraEnv?: Record<string, string>) {
  return spawnSync(process.execPath, [VERIFY_BIN_SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MEMENTO_VERIFY_BIN_ROOT: root,
      MEMENTO_VERIFY_BIN_LISTEN_DEADLINE_MS: '3000',
      MEMENTO_VERIFY_BIN_SETTLE_MS: '500',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

const SHEBANG = '#!/usr/bin/env node\n';

describe('verify-bin runtime checks (#1034)', () => {
  it('exit 0 진입점은 실패한다 (#1029 회귀)', () => {
    const root = createFakeProject({
      bin: {
        'memento-mcp-server': './entry.js',
        'memento-dev': './noop-listen.js',
        'memento-setup': './setup.js',
      },
      entries: {
        'entry.js': `${SHEBANG}process.exit(0);\n`,
        'noop-listen.js': `${SHEBANG}import net from 'net';\nnet.createServer().listen(Number(process.env.PORT), '127.0.0.1');\n`,
        'setup.js': `${SHEBANG}// static-only\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status).toBe(1);
    expect(combined).toMatch(/종료했습니다/);
  });

  it('살아 있는 진입점은 통과한다', () => {
    const root = createFakeProject({
      bin: {
        'memento-mcp-server': './entry.js',
        'memento-dev': './listen.js',
        'memento-setup': './setup.js',
      },
      entries: {
        'entry.js': `${SHEBANG}setInterval(() => {}, 1000);\n`,
        'listen.js': `${SHEBANG}import net from 'net';\nnet.createServer().listen(Number(process.env.PORT), '127.0.0.1');\n`,
        'setup.js': `${SHEBANG}// static-only\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status, combined).toBe(0);
    expect(combined).toMatch(/모든 bin 파일 검증 완료/);
  });

  it('listens: 포트를 잡으면 통과한다', () => {
    const root = createFakeProject({
      bin: {
        'memento-mcp-server': './alive.js',
        'memento-dev': './listen.js',
        'memento-setup': './setup.js',
      },
      entries: {
        'alive.js': `${SHEBANG}setInterval(() => {}, 1000);\n`,
        'listen.js': `${SHEBANG}import net from 'net';\nnet.createServer().listen(Number(process.env.PORT), '127.0.0.1');\n`,
        'setup.js': `${SHEBANG}// static-only\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status, combined).toBe(0);
  });

  it('listens: 살아만 있고 포트를 안 잡으면 실패한다', { timeout: 40_000 }, () => {
    const root = createFakeProject({
      bin: {
        'memento-mcp-server': './alive.js',
        'memento-dev': './no-listen.js',
        'memento-setup': './setup.js',
      },
      entries: {
        'alive.js': `${SHEBANG}setInterval(() => {}, 1000);\n`,
        'no-listen.js': `${SHEBANG}setInterval(() => {}, 1000);\n`,
        'setup.js': `${SHEBANG}// static-only\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status).toBe(1);
    expect(combined).toMatch(/포트 .* 를 잡지 못했습니다/);
  });

  it('stdin EOF 로 종료하는 stdio 서버도 통과한다 (#1034 하네스 회귀)', () => {
    // stdio MCP 서버는 stdin EOF 를 종료 신호로 읽는다 (server/index.ts 의
    // process.stdin.once('end')). 자식 stdin 을 'ignore' 로 주면 /dev/null 이 붙어
    // 즉시 EOF 가 나므로 멀쩡한 진입점이 거짓 실패한다. 2026-09-19 실제 dist 로
    // 재현했다: 'Server received stdio close, cleaning up...' 후 exit 0.
    const root = createFakeProject({
      bin: {
        'memento-mcp-server': './stdin-aware.js',
        'memento-setup': './setup.js',
      },
      entries: {
        'stdin-aware.js':
          `${SHEBANG}setInterval(() => {}, 1000);\nprocess.stdin.once('end', () => process.exit(0));\nprocess.stdin.resume();\n`,
        'setup.js': `${SHEBANG}// static-only\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status, combined).toBe(0);
    expect(combined).toMatch(/안정화 창/);
  });

  it('표에 없는 bin 이름은 실패한다', () => {
    const root = createFakeProject({
      bin: {
        'unknown-bin': './entry.js',
      },
      entries: {
        'entry.js': `${SHEBANG}setInterval(() => {}, 1000);\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status).toBe(1);
    expect(combined).toMatch(/BIN_EXPECTATIONS 에 기대치가 없습니다/);
  });

  it('static-only bin 은 스폰되지 않는다', () => {
    const root = createFakeProject({
      bin: {
        'memento-setup': './setup.js',
      },
      entries: {
        'setup.js': `${SHEBANG}import { writeFileSync } from 'fs';\nwriteFileSync('touched', 'yes');\n`,
      },
    });

    const result = runVerifyBin(root);
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status, combined).toBe(0);
    expect(combined).toMatch(/런타임 검사 건너뜀/);
    expect(existsSync(join(root, 'touched'))).toBe(false);
  });
});
