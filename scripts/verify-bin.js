#!/usr/bin/env node

/**
 * npm publish 전 bin 파일 검증 스크립트
 * bin 필드에 지정된 파일들이 존재하고 실행 가능한지 확인
 */

import { existsSync, statSync, mkdtempSync, rmSync } from 'fs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = process.env.MEMENTO_VERIFY_BIN_ROOT || join(__dirname, '..');

const SETTLE_MS = Number(process.env.MEMENTO_VERIFY_BIN_SETTLE_MS) || 2000;
const LISTEN_DEADLINE_MS = Number(process.env.MEMENTO_VERIFY_BIN_LISTEN_DEADLINE_MS) || 20000;
const LISTEN_POLL_MS = 100;

/**
 * bin 별 런타임 기대치 (#1034).
 *
 * 정적 검사는 아무 일도 하지 않고 exit 0 으로 끝나는 진입점을 통과시킨다. #1029 가 그 사례였다.
 * 그래서 서버류는 실제로 띄워 본다.
 *
 * 표에 없는 bin 이름이 나오면 검증을 실패시킨다. bin 을 추가하는 사람이 기대치를 함께 적게 만든다.
 */
const BIN_EXPECTATIONS = {
  // stdio MCP 서버. 띄운 뒤에도 살아 있어야 한다.
  // ponytail: 생존 확인까지만 한다. JSON-RPC initialize 핸드셰이크까지 검증하지는 않는다 —
  // exit 0 으로 끝나는 진입점(#1029)을 잡는 데는 생존 확인으로 충분하고, 프로토콜 왕복은
  // 발행 관문에 플레이크 표면을 늘린다. 핸드셰이크 회귀가 실제로 나면 그때 올린다.
  'memento-mcp-server': { mode: 'stays-alive' },

  // HTTP 서버. 살아 있고 배정된 포트를 잡아야 한다.
  'memento-dev': { mode: 'listens' },

  // 일회성 셋업 스크립트. 실행하면 저장소 루트에 .env 를 쓰고 네이티브 모듈을 재빌드하고
  // 시작 스크립트를 만든다. 검증 목적으로 돌릴 수 없으므로 정적 검사만 한다.
  'memento-setup': { mode: 'static-only', reason: 'mutates the working tree (.env, native rebuild)' },
};

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLimited(parts, chunk) {
  parts.push(chunk);
  while (parts.join('').length > 4000 && parts.length > 0) {
    parts.shift();
  }
}

function tailText(parts) {
  return parts.join('').slice(-4000);
}

function tryConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await waitForChildExit(child, 3000);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitForChildExit(child, 3000);
  }
}

function spawnBinChild(fullPath, env) {
  const stdoutParts = [];
  const stderrParts = [];
  const child = spawn(process.execPath, [fullPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: projectRoot,
  });

  child.stdout?.on('data', (chunk) => appendLimited(stdoutParts, chunk.toString()));
  child.stderr?.on('data', (chunk) => appendLimited(stderrParts, chunk.toString()));

  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  return {
    child,
    stdoutParts,
    stderrParts,
    get exited() {
      return exited;
    },
    get exitCode() {
      return exitCode;
    },
    get exitSignal() {
      return exitSignal;
    },
  };
}

async function verifyStaysAlive(name, fullPath, runtimeEnv) {
  const handle = spawnBinChild(fullPath, runtimeEnv);
  await delay(SETTLE_MS);

  if (handle.exited) {
    const stderrTail = tailText(handle.stderrParts);
    console.error(
      `❌ ${name}: 진입점이 서버를 띄우지 않고 종료했습니다 (exit=${handle.exitCode}, signal=${handle.exitSignal})`
    );
    if (stderrTail) {
      console.error(stderrTail);
    }
    await killChild(handle.child);
    return false;
  }

  await killChild(handle.child);
  return true;
}

async function verifyListens(name, fullPath, runtimeEnv) {
  const port = await reserveFreePort();
  const env = {
    ...runtimeEnv,
    MCP_SERVER_PORT: String(port),
    PORT: String(port),
  };
  const handle = spawnBinChild(fullPath, env);
  const deadline = Date.now() + LISTEN_DEADLINE_MS;

  while (Date.now() < deadline) {
    if (handle.exited) {
      const stderrTail = tailText(handle.stderrParts);
      console.error(
        `❌ ${name}: 진입점이 서버를 띄우지 않고 종료했습니다 (exit=${handle.exitCode}, signal=${handle.exitSignal})`
      );
      if (stderrTail) {
        console.error(stderrTail);
      }
      await killChild(handle.child);
      return false;
    }

    if (await tryConnect(port)) {
      await killChild(handle.child);
      return true;
    }

    await delay(LISTEN_POLL_MS);
  }

  console.error(`❌ ${name}: ${LISTEN_DEADLINE_MS}ms 안에 포트 ${port} 를 잡지 못했습니다`);
  const stderrTail = tailText(handle.stderrParts);
  if (stderrTail) {
    console.error(stderrTail);
  }
  await killChild(handle.child);
  return false;
}

async function main() {
  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf-8')
  );

  const bin = packageJson.bin;

  if (!bin) {
    console.error('❌ package.json에 bin 필드가 없습니다.');
    process.exit(1);
  }

  let hasErrors = false;
  let runtimeTmpDir = null;

  const FORBIDDEN_BIN_ALIASES = ['memento-mcp'];

  for (const forbidden of FORBIDDEN_BIN_ALIASES) {
    if (Object.prototype.hasOwnProperty.call(bin, forbidden)) {
      console.error(
        `❌ forbidden bin alias "${forbidden}" collides with unrelated packages; use memento-mcp-server (#766)`
      );
      hasErrors = true;
    }
  }

  try {
    for (const [name, path] of Object.entries(bin)) {
      if (path.startsWith('./packages/') || path.startsWith('packages/')) {
        console.error(`❌ workspace 내부 bin 경로는 사용할 수 없습니다: ${name} -> ${path}`);
        hasErrors = true;
        continue;
      }

      const fullPath = join(projectRoot, path);

      console.log(`\n🔍 검증 중: ${name} -> ${path}`);

      if (!existsSync(fullPath)) {
        console.error(`❌ 파일이 존재하지 않습니다: ${fullPath}`);
        hasErrors = true;
        continue;
      }

      try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) {
          console.error(`❌ 파일이 아닙니다: ${fullPath}`);
          hasErrors = true;
          continue;
        }
      } catch (error) {
        console.error(`❌ 파일 접근 실패: ${fullPath}`, error.message);
        hasErrors = true;
        continue;
      }

      if (path.endsWith('.js')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          if (!content.startsWith('#!/usr/bin/env node')) {
            console.warn(`⚠️  shebang이 없습니다: ${fullPath}`);
            console.warn(`   파일은 실행되지만, 직접 실행 시 문제가 될 수 있습니다.`);
          } else {
            console.log(`✅ shebang 확인됨`);
          }
        } catch (error) {
          console.error(`❌ 파일 읽기 실패: ${fullPath}`, error.message);
          hasErrors = true;
          continue;
        }
      }

      console.log(`✅ ${name} 검증 완료`);

      const expectation = BIN_EXPECTATIONS[name];
      if (!expectation) {
        console.error(
          `❌ ${name}: BIN_EXPECTATIONS 에 기대치가 없습니다. scripts/verify-bin.js 에 추가하세요.`
        );
        hasErrors = true;
        continue;
      }

      if (expectation.mode === 'static-only') {
        console.log(`⏭️  ${name}: 런타임 검사 건너뜀 (${expectation.reason})`);
        continue;
      }

      if (!runtimeTmpDir) {
        runtimeTmpDir = mkdtempSync(join(tmpdir(), 'verify-bin-'));
      }

      const runtimeEnv = {
        ...process.env,
        DB_PATH: join(runtimeTmpDir, 'verify.db'),
        MEMENTO_CONFIG_DIR: join(runtimeTmpDir, 'config'),
        MEMENTO_CLI_QUIET: '1',
        NODE_ENV: 'test',
      };

      if (expectation.mode === 'stays-alive') {
        const ok = await verifyStaysAlive(name, fullPath, runtimeEnv);
        if (!ok) {
          hasErrors = true;
        }
      } else if (expectation.mode === 'listens') {
        const ok = await verifyListens(name, fullPath, runtimeEnv);
        if (!ok) {
          hasErrors = true;
        }
      }
    }
  } finally {
    if (runtimeTmpDir) {
      rmSync(runtimeTmpDir, { recursive: true, force: true });
    }
  }

  if (hasErrors) {
    console.error('\n❌ bin 파일 검증 실패');
    console.error('npm publish 전에 모든 bin 파일이 올바르게 빌드되었는지 확인하세요.');
    process.exit(1);
  } else {
    console.log('\n✅ 모든 bin 파일 검증 완료');
  }
}

main().catch((error) => {
  console.error('❌ verify-bin 실행 중 오류:', error);
  process.exit(1);
});
