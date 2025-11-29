/**
 * 마이그레이션 로깅 시스템
 * 
 * 마이그레이션 실행 과정을 로그 파일에 기록합니다.
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { mementoConfig } from '../../../shared/config/index.js';
import type { MigrationResult } from '../../../tools/types.js';

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
  data?: any;
}

/**
 * 마이그레이션 로거
 */
export class MigrationLogger {
  private logDir: string;
  private logFile: string | null = null;
  private entries: LogEntry[] = [];

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
      console.error('❌ 로그 디렉토리 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 로그 파일 초기화
   */
  initializeLogFile(migrationVersion: string): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `migration_${migrationVersion}_${timestamp}.log`;
    this.logFile = join(this.logDir, fileName);
    this.entries = [];

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
  log(level: LogLevel, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      data
    };

    this.entries.push(entry);

    // 콘솔에도 출력
    const logMessage = `[${entry.timestamp.toISOString()}] [${level}] ${message}`;
    if (level === LogLevel.ERROR) {
      console.error(logMessage, data || '');
    } else if (level === LogLevel.WARN) {
      console.warn(logMessage, data || '');
    } else {
      console.log(logMessage, data || '');
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
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * WARN 레벨 로그
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * ERROR 레벨 로그
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * DEBUG 레벨 로그
   */
  debug(message: string, data?: any): void {
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
      console.error('❌ 로그 파일 쓰기 실패:', error);
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

