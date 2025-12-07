/**
 * 파일 로깅 모듈
 * 배치 작업의 에러 로그를 파일에 저장하는 기능 제공
 * 비동기 I/O를 사용하여 이벤트 루프 블로킹 방지
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

export interface FileLoggerConfig {
  logDir?: string; // 로그 디렉토리 (기본: process.cwd()/logs)
  logFileName?: string; // 로그 파일명 (기본: batch-scheduler.log)
  enabled?: boolean; // 로깅 활성화 여부 (기본: true)
}

export interface LogEntry {
  timestamp: Date;
  service: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: any;
  uptime?: number;
  activeJobs?: number;
  queueSize?: number;
}

/**
 * 파일 로거
 * 
 * 역할:
 * - 에러 로그를 파일에 저장
 * - 로그 디렉토리 자동 생성
 * - 로그 엔트리 포맷팅
 */
export class FileLogger {
  private config: Required<FileLoggerConfig>;
  private logFilePath: string;

  constructor(config: FileLoggerConfig = {}) {
    this.config = {
      logDir: config.logDir ?? path.join(process.cwd(), 'logs'),
      logFileName: config.logFileName ?? 'batch-scheduler.log',
      enabled: config.enabled ?? true
    };

    this.logFilePath = path.join(this.config.logDir, this.config.logFileName);
  }

  /**
   * 로그 엔트리 저장 (비동기)
   * 동기 I/O를 사용하지 않아 이벤트 루프 블로킹을 방지함
   * 
   * @param entry 로그 엔트리
   */
  async log(entry: LogEntry): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // 로그 디렉토리 존재 확인 및 생성 (비동기)
      try {
        await fsPromises.access(this.config.logDir);
      } catch {
        // 디렉토리가 없으면 생성
        await fsPromises.mkdir(this.config.logDir, { recursive: true });
      }

      // 데이터 정제
      const sanitizedEntry = {
        ...entry,
        data: this.sanitizeData(entry.data)
      };

      // 로그 엔트리 포맷팅
      const logLine = JSON.stringify(sanitizedEntry) + '\n';

      // 파일에 추가 (비동기)
      await fsPromises.appendFile(this.logFilePath, logLine);
    } catch (error) {
      // 파일 로깅 실패는 무시 (콘솔 로거 사용)
      // 실제 운영 환경에서는 콘솔 로거에 위임해야 함
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * 경고 로그 저장 (비동기)
   * 
   * @param message 메시지
   * @param data 추가 데이터
   * @param context 컨텍스트 정보
   */
  async logWarn(
    message: string,
    data?: any,
    context?: {
      uptime?: number;
      activeJobs?: number;
      queueSize?: number;
    }
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date(),
      service: 'BatchScheduler',
      level: 'warn',
      message,
      data: this.sanitizeData(data),
      ...context
    };

    await this.log(entry);
  }

  /**
   * 에러 로그 저장 (비동기)
   * 
   * @param message 메시지
   * @param data 추가 데이터
   * @param context 컨텍스트 정보
   */
  async logError(
    message: string,
    data?: any,
    context?: {
      uptime?: number;
      activeJobs?: number;
      queueSize?: number;
    }
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date(),
      service: 'BatchScheduler',
      level: 'error',
      message,
      data: this.sanitizeData(data),
      ...context
    };

    await this.log(entry);
  }

  /**
   * 데이터 정제 (Error 객체 처리)
   * 
   * @param data 원본 데이터
   * @returns 정제된 데이터
   */
  private sanitizeData(data?: any): Record<string, any> {
    if (data instanceof Error) {
      return {
        message: data.message,
        name: data.name,
        stack: data.stack
      };
    }

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return data;
    }

    return {};
  }

  /**
   * 로그 파일 경로 조회
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * 로깅 활성화/비활성화
   * 
   * @param enabled 활성화 여부
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

