/**
 * 파일 로깅 모듈
 * 배치 작업의 에러 로그를 파일에 저장하는 기능 제공
 * 비동기 I/O를 사용하여 이벤트 루프 블로킹 방지
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { PIIMasker } from '../../shared/utils/pii-masker.js';
import { validateFilePath, sanitizeFileName } from '../../shared/utils/path-validator.js';
import { logger } from '../../shared/utils/logger.js';

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
    // PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
    // 로그 디렉토리 경로 검증
    const logDir = config.logDir ?? path.join(process.cwd(), 'logs');
    if (!validateFilePath(logDir, 'logs')) {
      throw new Error(
        `Path Traversal 방지: 허용되지 않은 로그 디렉토리 경로입니다. ` +
        `경로: ${logDir}`
      );
    }

    // 로그 파일명 정제
    const logFileName = config.logFileName ?? 'batch-scheduler.log';
    const sanitizedFileName = sanitizeFileName(logFileName);

    this.config = {
      logDir,
      logFileName: sanitizedFileName,
      enabled: config.enabled ?? true
    };

    // 최종 로그 파일 경로 검증
    const logFilePath = path.join(this.config.logDir, this.config.logFileName);
    if (!validateFilePath(logFilePath, 'logs')) {
      throw new Error(
        `Path Traversal 방지: 허용되지 않은 로그 파일 경로입니다. ` +
        `경로: ${logFilePath}`
      );
    }

    this.logFilePath = logFilePath;
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

      // 데이터 정제 및 PII 마스킹
      // PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
      const sanitizedEntry = {
        ...entry,
        message: PIIMasker.mask(entry.message).masked, // 메시지의 PII 마스킹
        data: this.sanitizeData(entry.data)
      };

      // 로그 엔트리 포맷팅 (JSON 직렬화 후 전체 문자열에 PII 마스킹 적용)
      const logLineJson = JSON.stringify(sanitizedEntry);
      const maskedLogLine = PIIMasker.mask(logLineJson).masked;
      const logLine = maskedLogLine + '\n';

      // 파일에 추가 (비동기)
      await fsPromises.appendFile(this.logFilePath, logLine);
    } catch (error) {
      // 파일 로깅 실패는 무시 (콘솔 로거 사용)
      // 표준 로거로 에러 기록
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('Failed to write to log file', {
        error: maskedError.message,
        errorName: maskedError.name
      });
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
    // PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
    // 메시지의 PII 마스킹 (log() 메서드에서도 마스킹되지만, 이중 방어)
    const maskedMessage = PIIMasker.mask(message).masked;
    
    const entry: LogEntry = {
      timestamp: new Date(),
      service: 'BatchScheduler',
      level: 'warn',
      message: maskedMessage,
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
    // PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
    // 메시지의 PII 마스킹 (log() 메서드에서도 마스킹되지만, 이중 방어)
    const maskedMessage = PIIMasker.mask(message).masked;
    
    const entry: LogEntry = {
      timestamp: new Date(),
      service: 'BatchScheduler',
      level: 'error',
      message: maskedMessage,
      data: this.sanitizeData(data),
      ...context
    };

    await this.log(entry);
  }

  /**
   * 데이터 정제 (Error 객체 처리)
   * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
   * Error 객체의 message와 stack에 PII 마스킹 적용
   * 공통 유틸리티 함수 사용
   * 
   * @param data 원본 데이터
   * @returns 정제된 데이터 (PII 마스킹 적용)
   */
  private sanitizeData(data?: any): Record<string, any> {
    if (data instanceof Error) {
      // 공통 유틸리티 함수 사용
      return PIIMasker.maskError(data);
    }

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      // 공통 유틸리티 함수 사용
      return PIIMasker.maskObject(data);
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

