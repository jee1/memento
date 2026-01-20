/**
 * 설정 로더 공통 유틸리티
 * 
 * TOML 파일 로더, 설정 값 검증, 기본값 병합, 캐싱 기능을 제공합니다.
 * 
 * 주요 기능:
 * - TOML 파일 로드 및 파싱
 * - 설정 값 검증 (타입, 범위, 길이 등)
 * - 기본값과 설정 값 병합
 * - 프로세스 단위 싱글톤 캐싱
 * 
 * 사용 예시:
 * ```typescript
 * import { loadTOMLConfig, validateConfig, mergeWithDefaults, getCachedConfig } from './config-loader-utils.js';
 * 
 * // TOML 파일 로드
 * const config = loadTOMLConfig('config/my-config.toml', { default: 'value' });
 * 
 * // 설정 값 검증
 * const schema = { number: { type: 'number', min: 0, max: 100 } };
 * const result = validateConfig(config, schema);
 * 
 * // 기본값 병합
 * const merged = mergeWithDefaults(config, defaults);
 * 
 * // 캐싱된 설정 가져오기
 * const cached = getCachedConfig('my-config', () => loadTOMLConfig('config/my-config.toml'));
 * ```
 */

import { parse } from '@iarna/toml';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * 프로젝트 루트 디렉토리를 찾습니다.
 * 
 * 여러 경로를 시도하여 package.json이나 config 디렉토리가 있는 위치를 찾습니다.
 * 
 * @returns 프로젝트 루트 디렉토리 경로
 */
/**
 * 프로젝트 루트 디렉토리를 찾습니다.
 * 
 * 여러 경로를 시도하여 package.json이나 config 디렉토리가 있는 위치를 찾습니다.
 * 
 * @returns 프로젝트 루트 디렉토리 경로
 */
export function findProjectRoot(): string {
  // 현재 파일의 위치를 기준으로 시작
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // 가능한 프로젝트 루트 경로들 (현재 파일 위치에서 상위로 올라가며 확인)
  // 중복 제거를 위해 Set 사용
  const possibleRoots = new Set<string>([
    // dist/shared/config/에서 실행 시: ../../../
    join(__dirname, '../../..'),
    // dist/server/에서 실행 시: ../../
    join(__dirname, '../..'),
    // process.cwd()도 시도
    process.cwd()
  ]);
  
  // 각 경로에서 package.json이나 config 디렉토리가 있는지 확인
  for (const root of possibleRoots) {
    const normalizedRoot = resolve(root);
    const packageJsonPath = join(normalizedRoot, 'package.json');
    const configDirPath = join(normalizedRoot, 'config');
    const distConfigDirPath = join(normalizedRoot, 'dist', 'config');
    
    // package.json이 있거나, config 디렉토리가 있거나, dist/config 디렉토리가 있으면 프로젝트 루트로 인식
    if (existsSync(packageJsonPath) || existsSync(configDirPath) || existsSync(distConfigDirPath)) {
      return normalizedRoot;
    }
  }
  
  // 찾지 못하면 process.cwd() 반환 (fallback)
  return resolve(process.cwd());
}

/**
 * 설정 값 검증 스키마
 */
export interface ConfigValidationSchema {
  [key: string]: {
    type: 'number' | 'string' | 'boolean' | 'object' | 'array';
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  };
}

/**
 * 설정 값 검증 결과
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * TOML 파일에서 설정을 로드합니다.
 * 
 * @param configPath TOML 설정 파일 경로
 * @param defaults 기본값 (파일이 없거나 파싱 실패 시 사용)
 * @returns 설정 객체
 * @throws 파일을 읽을 수 없거나 파싱에 실패한 경우 (기본값이 제공되지 않은 경우)
 */
export function loadTOMLConfig<T = Record<string, unknown>>(
  configPath: string,
  defaults?: T
): T {
  try {
    const fileContent = readFileSync(configPath, 'utf-8');
    const parsed = parse(fileContent) as T;
    return parsed;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // 파일이 없으면 기본값 반환
      if (defaults !== undefined) {
        return defaults;
      }
      throw new Error(`설정 파일을 찾을 수 없습니다: ${configPath}`);
    }
    throw new Error(`TOML 파일 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 설정 값을 검증합니다.
 * 
 * @param config 검증할 설정 객체
 * @param schema 검증 스키마
 * @returns 검증 결과
 */
export function validateConfig(
  config: Record<string, unknown>,
  schema: ConfigValidationSchema
): ValidationResult {
  const errors: string[] = [];

  for (const [key, rule] of Object.entries(schema)) {
    const value = config[key];

    // 필수 필드 확인
    if (rule.required && (value === undefined || value === null)) {
      errors.push(`필수 필드 ${key}가 없습니다.`);
      continue;
    }

    // 값이 없으면 스킵 (선택적 필드)
    if (value === undefined || value === null) {
      continue;
    }

    // 타입 검증
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== rule.type) {
      errors.push(`필드 '${key}'의 타입이 올바르지 않습니다. 예상: ${rule.type}, 실제: ${actualType}. 값: ${JSON.stringify(value).substring(0, 100)}`);
      continue;
    }

    // 숫자 범위 검증
    if (rule.type === 'number' && typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push(`필드 '${key}'의 값(${value})이 최소값(${rule.min})보다 작습니다. 유효한 범위: ${rule.min}${rule.max !== undefined ? ` ~ ${rule.max}` : ' 이상'}`);
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push(`필드 '${key}'의 값(${value})이 최대값(${rule.max})보다 큽니다. 유효한 범위: ${rule.min !== undefined ? `${rule.min} ~ ` : ''}${rule.max} 이하`);
      }
    }

    // 문자열 길이 검증
    if (rule.type === 'string' && typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(`필드 '${key}'의 길이(${value.length})가 최소 길이(${rule.minLength})보다 짧습니다. 유효한 길이: ${rule.minLength}${rule.maxLength !== undefined ? ` ~ ${rule.maxLength}` : ' 이상'} 문자`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(`필드 '${key}'의 길이(${value.length})가 최대 길이(${rule.maxLength})보다 깁니다. 유효한 길이: ${rule.minLength !== undefined ? `${rule.minLength} ~ ` : ''}${rule.maxLength} 문자`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 기본값과 설정 값을 병합합니다.
 * 
 * @param config 설정 값
 * @param defaults 기본값
 * @returns 병합된 설정 객체
 */
export function mergeWithDefaults<T extends Record<string, unknown>>(
  config: Partial<T>,
  defaults: T
): T {
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null) {
      const typedKey = key as keyof T;
      if (typeof value === 'object' && !Array.isArray(value) && typeof defaults[typedKey] === 'object' && !Array.isArray(defaults[typedKey])) {
        // 중첩 객체 재귀적 병합
        (merged as any)[typedKey] = mergeWithDefaults(value as Record<string, unknown>, defaults[typedKey] as Record<string, unknown>);
      } else {
        (merged as any)[typedKey] = value;
      }
    }
  }

  return merged;
}

/**
 * 설정 캐시 (프로세스 단위 싱글톤)
 */
const configCache = new Map<string, unknown>();

/**
 * 캐싱된 설정을 가져옵니다.
 * 
 * @param key 캐시 키
 * @param loader 설정 로더 함수
 * @returns 설정 객체
 */
export function getCachedConfig<T>(key: string, loader: () => T): T {
  if (!configCache.has(key)) {
    configCache.set(key, loader());
  }
  return configCache.get(key) as T;
}

/**
 * 설정 캐시를 초기화합니다 (테스트용).
 * 
 * @param key 특정 키만 초기화 (지정하지 않으면 전체 초기화)
 */
export function clearConfigCache(key?: string): void {
  if (key) {
    configCache.delete(key);
  } else {
    configCache.clear();
  }
}

