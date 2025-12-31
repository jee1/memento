/**
 * 재시도 옵션 설정 로더
 * TOML 파일에서 재시도 옵션을 로드하고 검증합니다.
 */

import { parse } from '@iarna/toml';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RetryConfig } from '../../infrastructure/scheduler/retry-manager.js';
import { logger } from '../utils/logger.js';

export interface RetryOptionsConfig {
  default: RetryConfig;
  external_api: Omit<RetryConfig, 'maxErrorCount'>;
  embedding_api: Omit<RetryConfig, 'maxErrorCount'>;
  batch_job: RetryConfig;
}

const DEFAULT_CONFIG: RetryOptionsConfig = {
  default: {
    maxAttempts: 3,
    baseDelay: 100,
    maxErrorCount: 10
  },
  external_api: {
    maxAttempts: 3,
    baseDelay: 100
  },
  embedding_api: {
    maxAttempts: 3,
    baseDelay: 200
  },
  batch_job: {
    maxAttempts: 5,
    baseDelay: 1000,
    maxErrorCount: 20
  }
};

/**
 * TOML 파일에서 재시도 옵션 설정을 로드합니다.
 * @param configPath TOML 설정 파일 경로 (기본값: config/retry-options.toml)
 * @returns 재시도 옵션 설정 객체
 * @throws 설정 파일을 읽을 수 없거나 파싱에 실패한 경우
 */
export function loadRetryOptions(configPath?: string): RetryOptionsConfig {
  const defaultPath = join(process.cwd(), 'config', 'retry-options.toml');
  const path = configPath ?? defaultPath;

  try {
    const fileContent = readFileSync(path, 'utf-8');
    const parsed = parse(fileContent) as Partial<{
      default: { max_attempts?: number; base_delay_ms?: number; max_error_count?: number };
      external_api: { max_attempts?: number; base_delay_ms?: number };
      embedding_api: { max_attempts?: number; base_delay_ms?: number };
      batch_job: { max_attempts?: number; base_delay_ms?: number; max_error_count?: number };
    }>;

    // 기본값과 병합
    const config: RetryOptionsConfig = {
      default: {
        ...DEFAULT_CONFIG.default,
        ...(parsed.default ? {
          maxAttempts: parsed.default.max_attempts ?? DEFAULT_CONFIG.default.maxAttempts,
          baseDelay: parsed.default.base_delay_ms ?? DEFAULT_CONFIG.default.baseDelay,
          maxErrorCount: parsed.default.max_error_count ?? DEFAULT_CONFIG.default.maxErrorCount
        } : {})
      },
      external_api: {
        ...DEFAULT_CONFIG.external_api,
        ...(parsed.external_api ? {
          maxAttempts: parsed.external_api.max_attempts ?? DEFAULT_CONFIG.external_api.maxAttempts,
          baseDelay: parsed.external_api.base_delay_ms ?? DEFAULT_CONFIG.external_api.baseDelay
        } : {})
      },
      embedding_api: {
        ...DEFAULT_CONFIG.embedding_api,
        ...(parsed.embedding_api ? {
          maxAttempts: parsed.embedding_api.max_attempts ?? DEFAULT_CONFIG.embedding_api.maxAttempts,
          baseDelay: parsed.embedding_api.base_delay_ms ?? DEFAULT_CONFIG.embedding_api.baseDelay
        } : {})
      },
      batch_job: {
        ...DEFAULT_CONFIG.batch_job,
        ...(parsed.batch_job ? {
          maxAttempts: parsed.batch_job.max_attempts ?? DEFAULT_CONFIG.batch_job.maxAttempts,
          baseDelay: parsed.batch_job.base_delay_ms ?? DEFAULT_CONFIG.batch_job.baseDelay,
          maxErrorCount: parsed.batch_job.max_error_count ?? DEFAULT_CONFIG.batch_job.maxErrorCount
        } : {})
      }
    };

    // 값 검증
    validateRetryOptions(config);

    return config;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // 파일이 없으면 기본값 반환
      logger.warn('재시도 옵션 설정 파일을 찾을 수 없습니다. 기본값을 사용합니다.', {
        path,
        defaultConfig: DEFAULT_CONFIG
      });
      return DEFAULT_CONFIG;
    }
    throw new Error(`재시도 옵션 설정 로드 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 재시도 옵션 설정을 검증합니다.
 * @param config 검증할 설정 객체
 * @throws 설정 값이 유효하지 않은 경우
 */
function validateRetryOptions(config: RetryOptionsConfig): void {
  // default 검증
  validateRetryConfig('default', config.default);

  // external_api 검증
  if (config.external_api.maxAttempts <= 0 || !Number.isFinite(config.external_api.maxAttempts)) {
    throw new Error(`external_api.maxAttempts는 양수여야 합니다. 현재 값: ${config.external_api.maxAttempts}`);
  }
  if (config.external_api.baseDelay < 0 || !Number.isFinite(config.external_api.baseDelay)) {
    throw new Error(`external_api.baseDelay는 0 이상이어야 합니다. 현재 값: ${config.external_api.baseDelay}`);
  }

  // embedding_api 검증
  if (config.embedding_api.maxAttempts <= 0 || !Number.isFinite(config.embedding_api.maxAttempts)) {
    throw new Error(`embedding_api.maxAttempts는 양수여야 합니다. 현재 값: ${config.embedding_api.maxAttempts}`);
  }
  if (config.embedding_api.baseDelay < 0 || !Number.isFinite(config.embedding_api.baseDelay)) {
    throw new Error(`embedding_api.baseDelay는 0 이상이어야 합니다. 현재 값: ${config.embedding_api.baseDelay}`);
  }

  // batch_job 검증
  validateRetryConfig('batch_job', config.batch_job);
}

/**
 * RetryConfig 검증 헬퍼
 */
function validateRetryConfig(name: string, config: RetryConfig): void {
  if (config.maxAttempts <= 0 || !Number.isFinite(config.maxAttempts)) {
    throw new Error(`${name}.maxAttempts는 양수여야 합니다. 현재 값: ${config.maxAttempts}`);
  }
  if (config.baseDelay < 0 || !Number.isFinite(config.baseDelay)) {
    throw new Error(`${name}.baseDelay는 0 이상이어야 합니다. 현재 값: ${config.baseDelay}`);
  }
  if (config.maxErrorCount !== undefined) {
    if (config.maxErrorCount <= 0 || !Number.isFinite(config.maxErrorCount)) {
      throw new Error(`${name}.maxErrorCount는 양수여야 합니다. 현재 값: ${config.maxErrorCount}`);
    }
  }
}

/**
 * 싱글톤 인스턴스로 설정을 캐싱합니다.
 */
let cachedConfig: RetryOptionsConfig | null = null;

/**
 * 재시도 옵션 설정을 가져옵니다 (캐싱됨).
 * @param configPath TOML 설정 파일 경로
 * @returns 재시도 옵션 설정 객체
 */
export function getRetryOptions(configPath?: string): RetryOptionsConfig {
  if (!cachedConfig) {
    cachedConfig = loadRetryOptions(configPath);
  }
  return cachedConfig;
}

/**
 * 캐시된 설정을 초기화합니다 (테스트용).
 */
export function resetRetryOptionsCache(): void {
  cachedConfig = null;
}

