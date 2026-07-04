import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTransientCapacityError,
  logExternalApiRetry,
} from '../external-api-retry-logging.js';
import { logger } from '../logger.js';

describe('external-api-retry-logging', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isTransientCapacityError', () => {
    it('503 high demand 오류를 transient로 분류한다', () => {
      const error = new Error(
        '[GoogleGenerativeAI Error]: [503 Service Unavailable] This model is currently experiencing high demand.'
      );
      expect(isTransientCapacityError(error)).toBe(true);
    });

    it('일반 파싱 오류는 transient가 아니다', () => {
      expect(isTransientCapacityError(new Error('JSON parse failed'))).toBe(false);
    });
  });

  describe('logExternalApiRetry', () => {
    it('transient capacity 오류는 debug로 기록한다', () => {
      const error = new Error('503 Service Unavailable high demand');
      logExternalApiRetry('TripleExtractionService: Gemini API 호출 재시도', error, {
        attempt: 1,
        delay: 100,
        model: 'gemini-3-flash-preview',
      });

      expect(logger.debug).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('비-transient 오류는 warn으로 기록한다', () => {
      const error = new Error('ECONNREFUSED');
      logExternalApiRetry('TripleExtractionService: Gemini API 호출 재시도', error, {
        attempt: 1,
        delay: 100,
        model: 'gemini-3-flash-preview',
      });

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });
});
