/**
 * Triple 추출 전용 로거
 * 
 * rawLLMOutput을 로그 파일에 저장합니다.
 * 
 * 보안 정책:
 * - PII/비밀 정보 마스킹 적용
 * - logs/triple-extraction/ 디렉토리에 저장
 * - 날짜별 파일로 저장 (예: 2025-01-15.log)
 * - 30일 로테이션 (2.16에서 구현)
 * - 성공 케이스 10% 샘플링, 실패 케이스 100% 저장 (2.15에서 구현)
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { PIIMasker } from '../../shared/utils/pii-masker.js';
import type { TripleExtractionResult } from '../../shared/types/triple-extraction.js';

/**
 * Triple 추출 로그 엔트리
 */
export interface TripleExtractionLogEntry {
  timestamp: string;                    // ISO 8601 형식
  memory_id?: string;                   // Episodic Memory ID (선택사항)
  extraction_result: 'success' | 'failed'; // 추출 결과
  triples_count: number;                 // 추출된 triple 수
  failure_reason?: string;               // 실패 사유 (실패 시)
  steps?: {                               // 추출 단계 성공 여부
    canonicalization: boolean;
    entityLinking: boolean;
  };
  raw_llm_output?: string;                // 마스킹된 rawLLMOutput (디버깅용)
  observation_preview?: string;           // observation 일부 (최대 200자, PII 마스킹)
}

/**
 * Triple 추출 로거 설정
 */
export interface TripleExtractionLoggerConfig {
  /**
   * 로그 디렉토리 (기본: process.cwd()/logs/triple-extraction)
   */
  logDir?: string;
  
  /**
   * 로깅 활성화 여부 (기본: true)
   */
  enabled?: boolean;
  
  /**
   * PII 마스킹 활성화 여부 (기본: true)
   */
  enablePIIMasking?: boolean;
}

/**
 * Triple 추출 전용 로거
 */
export class TripleExtractionLogger {
  private config: Required<TripleExtractionLoggerConfig>;
  private logDir: string;

  constructor(config: TripleExtractionLoggerConfig = {}) {
    this.config = {
      logDir: config.logDir ?? path.join(process.cwd(), 'logs', 'triple-extraction'),
      enabled: config.enabled ?? true,
      enablePIIMasking: config.enablePIIMasking !== false
    };
    this.logDir = this.config.logDir;
  }

  /**
   * Triple 추출 결과 로깅
   * 
   * @param result Triple 추출 결과
   * @param memoryId Episodic Memory ID (선택사항)
   * @param observation Observation 텍스트 (선택사항, 미리보기용)
   */
  async logExtraction(
    result: TripleExtractionResult,
    memoryId?: string,
    observation?: string
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // 로그 디렉토리 생성
      await this.ensureLogDirectory();

      // 로그 엔트리 생성
      const entry = this.createLogEntry(result, memoryId, observation);

      // 날짜별 로그 파일 경로
      const logFilePath = this.getLogFilePath();

      // 로그 엔트리 포맷팅 (JSON Lines 형식)
      const logLine = JSON.stringify(entry) + '\n';

      // 파일에 추가 (비동기)
      await fsPromises.appendFile(logFilePath, logLine);
    } catch (error) {
      // 파일 로깅 실패는 무시 (콘솔 로거 사용)
      console.error('TripleExtractionLogger: 로그 파일 쓰기 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 로그 엔트리 생성
   */
  private createLogEntry(
    result: TripleExtractionResult,
    memoryId?: string,
    observation?: string
  ): TripleExtractionLogEntry {
    const extractionResult: 'success' | 'failed' = 
      result.triples.length > 0 ? 'success' : 'failed';

    // rawLLMOutput 마스킹
    let maskedRawOutput: string | undefined;
    if (result.extractionInfo.rawLLMOutput) {
      if (this.config.enablePIIMasking) {
        const maskingResult = PIIMasker.mask(result.extractionInfo.rawLLMOutput);
        maskedRawOutput = maskingResult.masked;
      } else {
        maskedRawOutput = result.extractionInfo.rawLLMOutput;
      }
    }

    // observation 미리보기 마스킹 (최대 200자)
    let observationPreview: string | undefined;
    if (observation) {
      const preview = observation.length > 200 
        ? observation.substring(0, 200) + '...'
        : observation;
      
      if (this.config.enablePIIMasking) {
        const maskingResult = PIIMasker.mask(preview);
        observationPreview = maskingResult.masked;
      } else {
        observationPreview = preview;
      }
    }

    const entry: TripleExtractionLogEntry = {
      timestamp: new Date().toISOString(),
      memory_id: memoryId,
      extraction_result: extractionResult,
      triples_count: result.triples.length,
      steps: result.extractionInfo.steps
    };

    // 실패 시 failure_reason 추가
    if (result.extractionInfo.failureReason) {
      entry.failure_reason = result.extractionInfo.failureReason;
    }

    // rawLLMOutput 추가 (마스킹된)
    if (maskedRawOutput) {
      entry.raw_llm_output = maskedRawOutput;
    }

    // observation 미리보기 추가 (마스킹된)
    if (observationPreview) {
      entry.observation_preview = observationPreview;
    }

    return entry;
  }

  /**
   * 로그 디렉토리 생성
   */
  private async ensureLogDirectory(): Promise<void> {
    try {
      await fsPromises.access(this.logDir);
    } catch {
      // 디렉토리가 없으면 생성
      await fsPromises.mkdir(this.logDir, { recursive: true });
    }
  }

  /**
   * 날짜별 로그 파일 경로 반환
   * 형식: YYYY-MM-DD.log
   */
  private getLogFilePath(): string {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const fileName = `${dateStr}.log`;
    return path.join(this.logDir, fileName);
  }

  /**
   * 로그 파일 목록 조회
   * 
   * @returns 로그 파일 경로 배열
   */
  async listLogFiles(): Promise<string[]> {
    try {
      await this.ensureLogDirectory();
      const files = await fsPromises.readdir(this.logDir);
      return files
        .filter(file => file.endsWith('.log'))
        .map(file => path.join(this.logDir, file))
        .sort()
        .reverse(); // 최신 파일 먼저
    } catch (error) {
      console.error('TripleExtractionLogger: 로그 파일 목록 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * 오래된 로그 파일 삭제 (30일 이상)
   * 
   * @param retentionDays 보존 기간 (일) (기본: 30일)
   */
  async deleteOldLogs(retentionDays: number = 30): Promise<number> {
    try {
      await this.ensureLogDirectory();
      const files = await fsPromises.readdir(this.logDir);
      const now = Date.now();
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.log')) {
          continue;
        }

        const filePath = path.join(this.logDir, file);
        const stats = await fsPromises.stat(filePath);
        const fileAge = now - stats.mtimeMs;

        if (fileAge > retentionMs) {
          await fsPromises.unlink(filePath);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('TripleExtractionLogger: 오래된 로그 파일 삭제 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }
}

/**
 * 싱글톤 인스턴스
 */
export const tripleExtractionLogger = new TripleExtractionLogger();

