/**
 * 설정 로더 공통 유틸리티 테스트
 * 
 * TOML 파일 로더, 설정 값 검증, 기본값 병합, 캐싱 기능 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadTOMLConfig,
  validateConfig,
  mergeWithDefaults,
  getCachedConfig,
  clearConfigCache
} from '../config-loader-utils.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

describe('config-loader-utils', () => {
  // 테스트별 고유 디렉터리 (process.cwd()/워커 차이·병렬 실행 시 경로 충돌 방지)
  let testConfigDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    clearConfigCache();
    testConfigDir = join(tmpdir(), `config-loader-test-${Date.now()}-${randomUUID()}`);
    testConfigPath = join(testConfigDir, 'test-config.toml');
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    if (testConfigDir && existsSync(testConfigDir)) {
      try {
        rmSync(testConfigDir, { recursive: true });
      } catch {
        // 무시
      }
    }
    clearConfigCache();
  });

  describe('3.1.1 TOML 파일 로더', () => {
    it('TOML 파일 로드 성공', () => {
      // Given: 유효한 TOML 파일
      const tomlContent = `
[section1]
key1 = "value1"
key2 = 123
key3 = 45.67

[section2]
nested = { key = "value" }
`;
      writeFileSync(testConfigPath, tomlContent, 'utf-8');

      // When: TOML 파일 로드
      const config = loadTOMLConfig(testConfigPath);

      // Then: 설정이 올바르게 로드됨
      expect(config).toBeDefined();
      expect((config as any).section1?.key1).toBe('value1');
      expect((config as any).section1?.key2).toBe(123);
    });

    it('TOML 파일이 없을 때 기본값 반환', () => {
      // Given: 존재하지 않는 파일 경로
      const nonExistentPath = join(testConfigDir, 'non-existent.toml');
      const defaults = { section1: { key1: 'default' } };

      // When: TOML 파일 로드
      const config = loadTOMLConfig(nonExistentPath, defaults);

      // Then: 기본값 반환
      expect(config).toEqual(defaults);
    });

    it('TOML 파일 파싱 실패 시 에러 throw', () => {
      // Given: 잘못된 TOML 파일
      const invalidToml = '[section\nkey = value';
      writeFileSync(testConfigPath, invalidToml, 'utf-8');

      // When/Then: 파싱 실패 시 에러 throw
      expect(() => {
        loadTOMLConfig(testConfigPath);
      }).toThrow();
    });
  });

  describe('3.1.1 설정 값 검증', () => {
    it('유효한 설정 값 검증 통과', () => {
      // Given: 유효한 설정 값
      const config = {
        number: 10,
        string: 'test',
        boolean: true
      };
      const schema = {
        number: { type: 'number', min: 0, max: 100 },
        string: { type: 'string', minLength: 1, maxLength: 100 },
        boolean: { type: 'boolean' }
      };

      // When: 검증
      const result = validateConfig(config, schema);

      // Then: 검증 통과
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('범위를 벗어난 값 검증 실패', () => {
      // Given: 범위를 벗어난 값
      const config = { number: 150 };
      const schema = {
        number: { type: 'number', min: 0, max: 100 }
      };

      // When: 검증
      const result = validateConfig(config, schema);

      // Then: 검증 실패
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('타입 불일치 검증 실패', () => {
      // Given: 타입이 다른 값
      const config = { number: 'not a number' };
      const schema = {
        number: { type: 'number' }
      };

      // When: 검증
      const result = validateConfig(config, schema);

      // Then: 검증 실패
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('3.1.1 기본값 병합', () => {
    it('기본값과 설정 값 병합', () => {
      // Given: 기본값과 설정 값
      const defaults = {
        section1: {
          key1: 'default1',
          key2: 'default2'
        },
        section2: {
          key3: 'default3'
        }
      };
      const config = {
        section1: {
          key1: 'override1'
        }
      };

      // When: 병합
      const merged = mergeWithDefaults(config, defaults);

      // Then: 기본값과 설정 값이 병합됨
      expect(merged.section1.key1).toBe('override1');
      expect(merged.section1.key2).toBe('default2');
      expect(merged.section2.key3).toBe('default3');
    });

    it('중첩 객체 병합', () => {
      // Given: 중첩된 기본값과 설정 값
      const defaults = {
        nested: {
          deep: {
            value: 'default'
          }
        }
      };
      const config = {
        nested: {
          deep: {
            value: 'override'
          }
        }
      };

      // When: 병합
      const merged = mergeWithDefaults(config, defaults);

      // Then: 중첩 객체가 올바르게 병합됨
      expect(merged.nested.deep.value).toBe('override');
    });
  });

  describe('3.1.1 캐싱', () => {
    it('설정 파일 캐싱 확인', () => {
      // Given: 설정 파일
      const tomlContent = '[section]\nkey = "value"';
      writeFileSync(testConfigPath, tomlContent, 'utf-8');

      // When: 두 번 로드
      const config1 = getCachedConfig('test-config', () => loadTOMLConfig(testConfigPath));
      const config2 = getCachedConfig('test-config', () => loadTOMLConfig(testConfigPath));

      // Then: 같은 인스턴스 반환 (캐싱됨)
      expect(config1).toBe(config2);
    });

    it('캐시 리셋 후 새로 로드', () => {
      // Given: 설정 파일
      const tomlContent = '[section]\nkey = "value"';
      writeFileSync(testConfigPath, tomlContent, 'utf-8');

      // When: 첫 번째 로드
      const config1 = getCachedConfig('test-config', () => loadTOMLConfig(testConfigPath));
      
      // 캐시 리셋
      clearConfigCache();
      
      // 두 번째 로드
      const config2 = getCachedConfig('test-config', () => loadTOMLConfig(testConfigPath));

      // Then: 다른 인스턴스 반환 (캐시 리셋됨)
      expect(config1).not.toBe(config2);
      // 하지만 값은 동일해야 함
      expect((config1 as any).section?.key).toBe((config2 as any).section?.key);
    });
  });
});

