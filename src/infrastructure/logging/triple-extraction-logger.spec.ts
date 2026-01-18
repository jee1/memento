/**
 * TripleExtractionLogger 테스트
 * Triple 추출 전용 로거 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TripleExtractionLogger } from './triple-extraction-logger.js';
import type { TripleExtractionResult } from '../../shared/types/triple-extraction.js';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { logger } from '../../shared/utils/logger.js';

describe('TripleExtractionLogger', () => {
  let testLogDir: string;
  let loggerInstance: TripleExtractionLogger;

  beforeEach(() => {
    // Given: 테스트용 로그 디렉토리 설정
    testLogDir = path.join(process.cwd(), 'logs', 'test-triple-extraction');
    loggerInstance = new TripleExtractionLogger({
      logDir: testLogDir,
      enabled: true
    });
  });

  afterEach(async () => {
    // When: 테스트 후 정리
    try {
      if (fs.existsSync(testLogDir)) {
        const files = await fsPromises.readdir(testLogDir);
        for (const file of files) {
          await fsPromises.unlink(path.join(testLogDir, file));
        }
        await fsPromises.rmdir(testLogDir);
      }
    } catch (error) {
      // 정리 실패는 무시
    }
  });

  describe('로깅 정책 통일 (console.* 제거)', () => {
    let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Given: Logger 스파이 설정
      loggerErrorSpy = vi.spyOn(logger, 'error');
      
      // console.* 스파이 설정 (사용되지 않아야 함)
      consoleErrorSpy = vi.spyOn(console, 'error');
    });

    afterEach(() => {
      // When: 테스트 후 정리
      vi.restoreAllMocks();
    });

    /**
     * Given: TripleExtractionLogger가 표준 로거를 사용하도록 변경됨
     * When: 로그 파일 쓰기 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('로그 파일 쓰기 실패 시 logger.error를 사용해야 함', async () => {
      // Given: 파일 쓰기가 실패하도록 모킹
      const originalAppendFile = fsPromises.appendFile;
      vi.spyOn(fsPromises, 'appendFile').mockRejectedValue(new Error('File write failed'));

      const testResult: TripleExtractionResult = {
        triples: [],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          },
          failureReason: 'Test failure'
        }
      };

      // When: 로그 추출 시도 (파일 쓰기 실패 시뮬레이션)
      await loggerInstance.logExtraction(testResult, 'test-memory-id', 'test observation');

      // 파일 쓰기 실패 처리를 위해 약간의 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('로그 파일 쓰기 실패'))).toBe(true);
      
      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 원본 함수 복원
      vi.spyOn(fsPromises, 'appendFile').mockRestore();
    });

    /**
     * Given: TripleExtractionLogger가 표준 로거를 사용하도록 변경됨
     * When: 로그 파일 목록 조회 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('로그 파일 목록 조회 실패 시 logger.error를 사용해야 함', async () => {
      // Given: readdir가 실패하도록 모킹
      vi.spyOn(fsPromises, 'readdir').mockRejectedValue(new Error('Directory read failed'));

      // When: 로그 파일 목록 조회 시도 (실패 시뮬레이션)
      await loggerInstance.listLogFiles();

      // 파일 읽기 실패 처리를 위해 약간의 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('로그 파일 목록 조회 실패'))).toBe(true);
      
      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 원본 함수 복원
      vi.spyOn(fsPromises, 'readdir').mockRestore();
    });

    /**
     * Given: TripleExtractionLogger가 표준 로거를 사용하도록 변경됨
     * When: 오래된 로그 파일 삭제 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('오래된 로그 파일 삭제 실패 시 logger.error를 사용해야 함', async () => {
      // Given: readdir가 실패하도록 모킹
      vi.spyOn(fsPromises, 'readdir').mockRejectedValue(new Error('Directory read failed'));

      // When: 오래된 로그 파일 삭제 시도 (실패 시뮬레이션)
      await loggerInstance.deleteOldLogs(30);

      // 파일 삭제 실패 처리를 위해 약간의 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('오래된 로그 파일 삭제 실패'))).toBe(true);
      
      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 원본 함수 복원
      vi.spyOn(fsPromises, 'readdir').mockRestore();
    });
  });
});
