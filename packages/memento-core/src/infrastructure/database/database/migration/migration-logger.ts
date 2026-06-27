/**
 * 마이그레이션 로깅 시스템
 * 
 * 마이그레이션 실행 과정을 로그 파일에 기록합니다.
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { mementoConfig } from '../../../../shared/config/index.js';
import { PIIMasker } from '../../../../shared/utils/pii-masker.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { MigrationResult } from './types.js';

/**
 * 로그 레벨
 */
export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG'
}

/**
 * 로그 엔트리
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * 마이그레이션 로거
 */
export class MigrationLogger {
  private logDir: string;
  private logFile: string | null = null;
  private entries: LogEntry[] = [];
  /** true면 파일 로그만 건너뜀(읽기 전용 볼륨 등). 콘솔 로그는 유지. */
  private fileLoggingDisabled = false;

  constructor(logDir?: string) {
    // 기본 로그 디렉토리: data/logs
    const dbDir = dirname(mementoConfig.dbPath);
    this.logDir = logDir || join(dbDir, 'logs');
    this.ensureLogDirectory();
  }

  /**
   * 로그 디렉토리 생성
   */
  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.warn('⚠️ 마이그레이션 로그 디렉터리를 만들 수 없습니다. 파일 로깅을 건너뜁니다.', {
        error: maskedError.message,
        errorName: maskedError.name,
        logDir: this.logDir,
      });
      this.fileLoggingDisabled = true;
    }
  }

  /**
   * 파일 로깅이 비활성화인지(테스트·진단용)
   */
  isFileLoggingDisabled(): boolean {
    return this.fileLoggingDisabled;
  }

  /**
   * 로그 파일 초기화
   */
  initializeLogFile(migrationVersion: string): void {
    this.entries = [];
    if (this.fileLoggingDisabled) {
      this.logFile = null;
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `migration_${migrationVersion}_${timestamp}.log`;
    this.logFile = join(this.logDir, fileName);

    // 로그 파일 헤더 작성
    this.writeToFile(`=== 마이그레이션 로그 시작 ===\n`);
    this.writeToFile(`마이그레이션 버전: ${migrationVersion}\n`);
    this.writeToFile(`시작 시간: ${new Date().toISOString()}\n`);
    this.writeToFile(`데이터베이스 경로: ${mementoConfig.dbPath}\n`);
    this.writeToFile(`================================\n\n`);
  }

  /**
   * 로그 기록
   */
  log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      data
    };

    this.entries.push(entry);

    // 표준 로거로 출력
    const logMessage = `[${entry.timestamp.toISOString()}] [${level}] ${message}`;
    const metadata = data ? { data } : undefined;
    if (level === LogLevel.ERROR) {
      logger.error(logMessage, metadata);
    } else if (level === LogLevel.WARN) {
      logger.warn(logMessage, metadata);
    } else {
      logger.info(logMessage, metadata);
    }

    // 파일에 기록
    if (this.logFile) {
      const fileMessage = `${logMessage}${data ? ` ${JSON.stringify(data, null, 2)}` : ''}\n`;
      this.writeToFile(fileMessage);
    }
  }

  /**
   * INFO 레벨 로그
   */
  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * WARN 레벨 로그
   */
  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * ERROR 레벨 로그
   */
  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * DEBUG 레벨 로그
   */
  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * 마이그레이션 결과 기록
   */
  logMigrationResult(result: MigrationResult): void {
    this.writeToFile(`\n=== 마이그레이션 결과 ===\n`);
    this.writeToFile(`버전: ${result.version}\n`);
    this.writeToFile(`이름: ${result.name}\n`);
    this.writeToFile(`성공 여부: ${result.success ? '성공' : '실패'}\n`);
    this.writeToFile(`시작 시간: ${result.startTime.toISOString()}\n`);
    if (result.endTime) {
      const duration = result.endTime.getTime() - result.startTime.getTime();
      this.writeToFile(`종료 시간: ${result.endTime.toISOString()}\n`);
      this.writeToFile(`소요 시간: ${duration}ms\n`);
    }
    if (result.error) {
      this.writeToFile(`에러: ${result.error}\n`);
    }
    if (result.rollbackSuccess !== undefined) {
      this.writeToFile(`롤백 성공 여부: ${result.rollbackSuccess ? '성공' : '실패'}\n`);
    }
    this.writeToFile(`========================\n\n`);
  }

  /**
   * 로그 파일에 쓰기
   */
  private writeToFile(content: string): void {
    if (!this.logFile) {
      return;
    }

    try {
      fs.appendFileSync(this.logFile, content, 'utf-8');
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 로그 파일 쓰기 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
    }
  }

  /**
   * 로그 파일 경로 반환
   */
  getLogFile(): string | null {
    return this.logFile;
  }

  /**
   * 로그 엔트리 조회
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * 로그 디렉토리 경로 반환
   */
  getLogDirectory(): string {
    return this.logDir;
  }
}

