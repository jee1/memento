/**
 * 재시도 옵션 설정 로더 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadRetryOptions, getRetryOptions, resetRetryOptionsCache } from '../retry-options-loader.js';
import { join } from 'path';

describe('retry-options-loader', () => {
  beforeEach(() => {
    resetRetryOptionsCache();
  });

  it('기본 설정 파일 로드', () => {
    // Given: 기본 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 설정 파일 로드
    const config = loadRetryOptions(configPath);

    // Then: 기본 설정이 로드됨
    expect(config.default).toBeDefined();
    expect(config.default.maxAttempts).toBeGreaterThan(0);
    expect(config.default.baseDelay).toBeGreaterThanOrEqual(0);
    expect(config.external_api).toBeDefined();
    expect(config.embedding_api).toBeDefined();
    expect(config.batch_job).toBeDefined();
  });

  it('설정 파일이 없을 때 기본값 반환', () => {
    // Given: 존재하지 않는 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'non-existent.toml');

    // When: 설정 파일 로드
    const config = loadRetryOptions(configPath);

    // Then: 기본값이 반환됨
    expect(config.default.maxAttempts).toBe(3);
    expect(config.default.baseDelay).toBe(100);
    expect(config.default.maxErrorCount).toBe(10);
  });

  it('설정 값 검증 - 유효한 값', () => {
    // Given: 유효한 설정 파일
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 설정 파일 로드
    const config = loadRetryOptions(configPath);

    // Then: 검증 통과
    expect(config.default.maxAttempts).toBeGreaterThan(0);
    expect(config.default.baseDelay).toBeGreaterThanOrEqual(0);
  });

  it('싱글톤 캐싱 확인', () => {
    // Given: 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 두 번 호출
    const config1 = getRetryOptions(configPath);
    const config2 = getRetryOptions(configPath);

    // Then: 같은 인스턴스 반환
    expect(config1).toBe(config2);
  });

  it('캐시 리셋 후 새로 로드', () => {
    // Given: 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 첫 번째 로드
    const config1 = getRetryOptions(configPath);
    
    // 캐시 리셋
    resetRetryOptionsCache();
    
    // 두 번째 로드
    const config2 = getRetryOptions(configPath);

    // Then: 다른 인스턴스 반환 (캐시 리셋됨)
    expect(config1).not.toBe(config2);
    // 하지만 값은 동일해야 함
    expect(config1.default.maxAttempts).toBe(config2.default.maxAttempts);
  });

  it('외부 API 설정 로드', () => {
    // Given: 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 설정 파일 로드
    const config = loadRetryOptions(configPath);

    // Then: external_api 설정이 있음
    expect(config.external_api).toBeDefined();
    expect(config.external_api.maxAttempts).toBeGreaterThan(0);
    expect(config.external_api.baseDelay).toBeGreaterThanOrEqual(0);
  });

  it('임베딩 API 설정 로드', () => {
    // Given: 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 설정 파일 로드
    const config = loadRetryOptions(configPath);

    // Then: embedding_api 설정이 있음
    expect(config.embedding_api).toBeDefined();
    expect(config.embedding_api.maxAttempts).toBeGreaterThan(0);
    expect(config.embedding_api.baseDelay).toBeGreaterThanOrEqual(0);
  });

  it('배치 작업 설정 로드', () => {
    // Given: 설정 파일 경로
    const configPath = join(process.cwd(), 'config', 'retry-options.toml');

    // When: 설정 파일 로드
    const config = loadRetryOptions(configPath);

    // Then: batch_job 설정이 있음
    expect(config.batch_job).toBeDefined();
    expect(config.batch_job.maxAttempts).toBeGreaterThan(0);
    expect(config.batch_job.baseDelay).toBeGreaterThanOrEqual(0);
    expect(config.batch_job.maxErrorCount).toBeGreaterThan(0);
  });
});

