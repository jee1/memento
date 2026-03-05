/**
 * RelationValidatorExecutor 테스트
 * 관계 검증 실행자 기능 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelationValidatorExecutor } from '../relation-validator-executor.js';
import { spawn } from 'child_process';

// child_process 모듈 모킹
vi.mock('child_process', () => {
  return {
    spawn: vi.fn()
  };
});

describe('RelationValidatorExecutor', () => {
  let executor: RelationValidatorExecutor;
  let mockChildProcess: any;

  beforeEach(() => {
    executor = new RelationValidatorExecutor();
    
    // Mock child process 설정
    mockChildProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
      pid: 12345
    };

    (spawn as any).mockReturnValue(mockChildProcess);
  });

  describe('execute', () => {
    it('should execute script successfully', async () => {
      // Given: 성공적으로 종료되는 프로세스
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      // When: 스크립트 실행
      const result = await executor.execute();

      // Then: 성공 결과 반환
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle script failure', async () => {
      // Given: 실패로 종료되는 프로세스
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 10);
        }
      });
      mockChildProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          callback(Buffer.from('Error occurred'));
        }
      });

      // When: 스크립트 실행
      const result = await executor.execute();

      // Then: 실패 결과 반환
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should preserve stdout and stderr on failure', async () => {
      // Given: stdout와 stderr를 출력한 후 실패하는 프로세스
      let stdoutData = '';
      let stderrData = '';
      
      mockChildProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          stdoutData += 'Some stdout output';
          callback(Buffer.from('Some stdout output'));
        }
      });
      
      mockChildProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          stderrData += 'Some stderr output';
          callback(Buffer.from('Some stderr output'));
        }
      });
      
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 10); // 실패 코드
        }
      });

      // When: 스크립트 실행
      const result = await executor.execute();

      // Then: 실패 시에도 수집한 stdout/stderr가 반환되어야 함
      expect(result.success).toBe(false);
      expect(result.stdout).toBe('Some stdout output'); // 빈 문자열이 아닌 수집한 값
      expect(result.stderr).toBe('Some stderr output'); // 빈 문자열이 아닌 수집한 값
      expect(result.error).toBeDefined();
    });

    it('should preserve stdout and stderr on timeout', async () => {
      // Given: stdout와 stderr를 출력한 후 타임아웃되는 프로세스
      let stdoutData = '';
      let stderrData = '';
      
      mockChildProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          stdoutData += 'Timeout stdout output';
          callback(Buffer.from('Timeout stdout output'));
        }
      });
      
      mockChildProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          stderrData += 'Timeout stderr output';
          callback(Buffer.from('Timeout stderr output'));
        }
      });
      
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        // close 이벤트가 발생하지 않도록 함 (타임아웃 유발)
      });

      // When: 짧은 타임아웃으로 스크립트 실행
      const result = await executor.execute([], 100);

      // Then: 타임아웃 시에도 수집한 stdout/stderr가 반환되어야 함
      expect(result.success).toBe(false);
      expect(result.stdout).toBe('Timeout stdout output'); // 빈 문자열이 아닌 수집한 값
      expect(result.stderr).toBe('Timeout stderr output'); // 빈 문자열이 아닌 수집한 값
      expect(result.error).toContain('timeout');
    });

    it('should handle timeout', async () => {
      // Given: 타임아웃이 발생하는 프로세스
      const shortTimeout = 100; // 100ms
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        // close 이벤트가 발생하지 않도록 함 (타임아웃 유발)
      });

      // When: 짧은 타임아웃으로 스크립트 실행
      const result = await executor.execute([], shortTimeout);

      // Then: 타임아웃 에러 반환
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
      expect(mockChildProcess.kill).toHaveBeenCalled();
    });

    it('should use custom timeout when provided', async () => {
      // Given: 커스텀 타임아웃
      const customTimeout = 2000;
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        // 타임아웃 유발
      });

      // When: 커스텀 타임아웃으로 실행
      const startTime = Date.now();
      await executor.execute([], customTimeout);
      const duration = Date.now() - startTime;

      // Then: 커스텀 타임아웃 사용
      expect(duration).toBeGreaterThanOrEqual(customTimeout - 100);
      expect(duration).toBeLessThan(customTimeout + 500);
    });

    it('should pass additional arguments to script', async () => {
      // Given: 추가 인자
      const additionalArgs = ['--custom-arg', 'value'];
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      });

      // When: 추가 인자와 함께 실행
      await executor.execute(additionalArgs);

      // Then: spawn이 올바른 인자로 호출됨
      expect(spawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['tsx', expect.any(String), ...additionalArgs]),
        expect.any(Object)
      );
    });

    it('should calculate duration correctly', async () => {
      // Given: 실행 시간이 걸리는 프로세스
      mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 50);
        }
      });

      // When: 스크립트 실행
      const result = await executor.execute();

      // Then: 실행 시간이 계산됨
      expect(result.duration).toBeGreaterThanOrEqual(40);
      expect(result.duration).toBeLessThan(200);
    });
  });
});

