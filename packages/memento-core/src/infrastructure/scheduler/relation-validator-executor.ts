/**
 * 관계 검증 실행자 모듈
 * 주간 관계 추출 품질 검증 스크립트를 child process로 실행하는 기능 제공
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export interface RelationValidatorConfig {
  scriptPath?: string; // 스크립트 경로 (기본: scripts/weekly-relation-validation.ts)
  timeout?: number; // 타임아웃 (밀리초)
  defaultArgs?: string[]; // 기본 인자
  repoRoot?: string; // monorepo 루트 (기본: 자동 탐색)
}

interface TsxCommand {
  command: string;
  argsPrefix: string[];
}

/** package.json의 workspaces 또는 weekly-relation-validation 스크립트로 repo root 탐색 */
export function resolveMementoRepoRoot(startDir?: string): string {
  let dir = startDir ?? dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 12; depth += 1) {
    const pkgPath = join(dir, 'package.json');
    /* eslint-disable security/detect-non-literal-fs-filename -- monorepo root walk-up */
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          workspaces?: unknown;
          scripts?: Record<string, string>;
        };
        if (pkg.workspaces || pkg.scripts?.['weekly-relation-validation']) {
          return dir;
        }
      } catch {
        // malformed package.json — keep walking up
      }
    }
    /* eslint-enable security/detect-non-literal-fs-filename */

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return process.cwd();
}

function resolveTsxCommand(repoRoot: string): TsxCommand {
  const localTsx = join(repoRoot, 'node_modules', '.bin', 'tsx');
  /* eslint-disable-next-line security/detect-non-literal-fs-filename -- resolved repo-local binary */
  if (existsSync(localTsx)) {
    return { command: localTsx, argsPrefix: [] };
  }
  return { command: 'npx', argsPrefix: ['--yes', 'tsx'] };
}

export interface RelationValidatorResult {
  success: boolean;
  stdout: string;
  stderr: string;
  duration: number; // 밀리초
  error?: string;
}

/**
 * 관계 검증 실행자
 * 
 * 역할:
 * - 주간 관계 검증 스크립트 실행
 * - 타임아웃 관리
 * - 프로세스 강제 종료 처리
 */
export class RelationValidatorExecutor {
  private config: Required<RelationValidatorConfig>;

  constructor(config: RelationValidatorConfig = {}) {
    const repoRoot = config.repoRoot ?? resolveMementoRepoRoot();
    this.config = {
      repoRoot,
      scriptPath: config.scriptPath ?? join(repoRoot, 'scripts', 'weekly-relation-validation.ts'),
      timeout: config.timeout ?? 5 * 60 * 1000, // 기본 5분 (스케줄러가 weeklyRelationValidationTimeout으로 덮어씀)
      defaultArgs: config.defaultArgs ?? ['--method', 'rule', '--allow-soft-fail']
    };
  }

  /**
   * 관계 검증 스크립트 실행
   * 
   * @param args 추가 인자
   * @param timeout 타임아웃 (밀리초, 선택적)
   * @returns 실행 결과
   */
  async execute(args: string[] = [], timeout?: number): Promise<RelationValidatorResult> {
    const startTime = Date.now();
    const actualTimeout = timeout ?? this.config.timeout;
    let childProcess: ChildProcess | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    // stdout과 stderr를 try 블록 밖에서 선언하여 catch 블록에서도 접근 가능하도록 함
    let stdout = '';
    let stderr = '';

    try {
      // 스크립트 실행
      const scriptArgs = [...this.config.defaultArgs, ...args];
      const { command, argsPrefix } = resolveTsxCommand(this.config.repoRoot);
      childProcess = spawn(command, [...argsPrefix, this.config.scriptPath, ...scriptArgs], {
        cwd: this.config.repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // 타임아웃 설정
      const result = await Promise.race([
        new Promise<RelationValidatorResult>((resolve, reject) => {
          if (!childProcess) {
            reject(new Error('Child process not initialized'));
            return;
          }

          childProcess.on('close', (code) => {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            if (code === 0) {
              resolve({
                success: true,
                stdout,
                stderr,
                duration: Date.now() - startTime
              });
            } else {
              reject(new Error(`Script exited with code ${code}\n${stderr}`));
            }
          });

          childProcess.on('error', (error) => {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            reject(error);
          });
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            if (childProcess && !childProcess.killed) {
              // 강제 종료
              childProcess.kill('SIGTERM');
              
              // SIGTERM으로 종료되지 않으면 SIGKILL 사용
              setTimeout(() => {
                if (childProcess && !childProcess.killed) {
                  childProcess.kill('SIGKILL');
                }
              }, 5000);
            }
            reject(new Error(`Relation validation timeout after ${actualTimeout}ms`));
          }, actualTimeout);
        })
      ]);

      return result;
    } catch (error) {
      // 타임아웃 정리
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // 실패 시에도 수집한 stdout/stderr를 그대로 반환하여 디버깅 가능하도록 함
      return {
        success: false,
        stdout, // 빈 문자열이 아닌 수집한 값 반환
        stderr, // 빈 문자열이 아닌 수집한 값 반환
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

