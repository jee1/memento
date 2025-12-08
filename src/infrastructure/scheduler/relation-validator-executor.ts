/**
 * 관계 검증 실행자 모듈
 * 주간 관계 추출 품질 검증 스크립트를 child process로 실행하는 기능 제공
 */

import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';

export interface RelationValidatorConfig {
  scriptPath?: string; // 스크립트 경로 (기본: scripts/weekly-relation-validation.ts)
  timeout?: number; // 타임아웃 (밀리초)
  defaultArgs?: string[]; // 기본 인자
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
    this.config = {
      scriptPath: config.scriptPath ?? join(process.cwd(), 'scripts', 'weekly-relation-validation.ts'),
      timeout: config.timeout ?? 5 * 60 * 1000, // 기본 5분
      defaultArgs: config.defaultArgs ?? ['--method', 'hybrid', '--allow-soft-fail']
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
      childProcess = spawn('npx', ['tsx', this.config.scriptPath, ...scriptArgs], {
        cwd: process.cwd(),
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

