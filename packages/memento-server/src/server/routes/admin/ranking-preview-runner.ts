/* eslint-disable security/detect-non-literal-fs-filename -- 탐색 경로는 이 모듈의 위치와 고정 상대 경로뿐이다. HTTP 입력이 닿지 않는다. */
/**
 * 랭킹 미리보기를 별도 프로세스로 실행한다 (#1584).
 *
 * 평가는 getRankingWeights 전역 캐시와 MEMENTO_RANKING_WEIGHTS_PATH 를 바꾼다.
 * 서버 프로세스 안에서 돌리면 운영 랭킹이 바뀌므로 반드시 자식 프로세스에서만 돌린다.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join('scripts', 'ranking-preview.ts');
const REQUIRED_FIXTURE = join('tests', 'fixtures', 'search-quality', 'benchmark-v3', 'split.json');
const MAX_ANCESTOR_DEPTH = 8;
const MAX_STDOUT_BYTES = 1_000_000;
const STDERR_TAIL_CHARS = 2000;
const CHILD_TIMEOUT_EXIT = 124;

export type PreviewOutcome =
  | { status: 'ok'; result: unknown }
  | { status: 'timeout' }
  | { status: 'failed'; message: string };

export interface PreviewRunOptions {
  projectRoot: string;
  timeoutMs: number;
  maxOldSpaceMb: number;
  /** 테스트가 작은 fixture 로 바꿀 때만 쓴다. */
  extraArgs?: readonly string[];
  spawnFn?: typeof spawn;
}

/** 런너 스크립트와 benchmark-v3 fixture 가 있는 저장소 루트. 이미지에 없으면 null. */
export function findPreviewProjectRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
    if (existsSync(join(dir, SCRIPT)) && existsSync(join(dir, REQUIRED_FIXTURE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function runRankingPreviewChild(
  input: { changes: object; profilePath: string },
  options: PreviewRunOptions,
): Promise<PreviewOutcome> {
  const spawnFn = options.spawnFn ?? spawn;
  const args = [
    `--max-old-space-size=${options.maxOldSpaceMb}`,
    '--import',
    'tsx',
    join(options.projectRoot, SCRIPT),
    '--changes',
    JSON.stringify(input.changes),
    '--current-profile',
    input.profilePath,
    '--timeout-ms',
    String(options.timeoutMs),
    ...(options.extraArgs ?? []),
  ];

  // 자식의 임시 파일(시드 DB, 제안 toml)은 실행마다 만든 이 디렉터리에만 둔다. SIGKILL 로 끝나도 부모가 지운다.
  const workDir = mkdtempSync(join(tmpdir(), 'memento-ranking-preview-'));
  const removeWorkDir = (): void => rmSync(workDir, { recursive: true, force: true });

  return new Promise<PreviewOutcome>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(process.execPath, args, {
        cwd: options.projectRoot,
        env: { ...process.env, TMPDIR: workDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      removeWorkDir();
      resolve({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (outcome: PreviewOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeWorkDir();
      resolve(outcome);
    };
    // 자식도 같은 시간 상한으로 스스로 끝나지만, 멈춘 자식을 서버가 직접 정리한다.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs + 1000);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS);
    });
    child.on('error', (error) => finish({ status: 'failed', message: error.message }));
    child.on('close', (code) => {
      if (timedOut || code === CHILD_TIMEOUT_EXIT) return finish({ status: 'timeout' });
      if (code !== 0) return finish({ status: 'failed', message: stderr.trim() || `exit code ${String(code)}` });
      const lastLine = stdout.trim().split('\n').at(-1) ?? '';
      try {
        return finish({ status: 'ok', result: JSON.parse(lastLine) as unknown });
      } catch {
        return finish({ status: 'failed', message: 'preview output is not JSON' });
      }
    });
  });
}
