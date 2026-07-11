import type { MemoryType, PrivacyScope } from '../types.js';

/**
 * 유효한 메모리 타입인지 확인
 */
export function isValidMemoryType(type: string): type is MemoryType {
  return ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'].includes(type);
}

/**
 * 유효한 프라이버시 스코프인지 확인
 */
export function isValidPrivacyScope(scope: string): scope is PrivacyScope {
  return ['private', 'team', 'public'].includes(scope);
}

/**
 * 유효한 중요도 값인지 확인 (0-1 범위)
 */
export function isValidImportance(importance: number): boolean {
  return typeof importance === 'number' && importance >= 0 && importance <= 1;
}

/**
 * 메모리 생성 파라미터 검증
 */
export function validateCreateMemoryParams(params: unknown): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof params !== 'object' || params === null) {
    return { isValid: false, errors: ['params는 객체여야 합니다'] };
  }

  const p = params as Record<string, unknown>;

  if (p.type === 'core' || p.type === 'vault') {
    if (!p.key || typeof p.key !== 'string') {
      errors.push('type이 "core" 또는 "vault"일 때 key는 필수이며 문자열이어야 합니다');
    }
    if (!p.value || typeof p.value !== 'string') {
      errors.push('type이 "core" 또는 "vault"일 때 value는 필수이며 문자열이어야 합니다');
    }
  } else {
    if (!p.content || typeof p.content !== 'string') {
      errors.push('content는 필수이며 문자열이어야 합니다 (type이 "core" 또는 "vault"가 아닌 경우)');
    }
  }

  if (p.type && typeof p.type === 'string' && !isValidMemoryType(p.type)) {
    errors.push('type은 working, episodic, semantic, procedural, core, vault 중 하나여야 합니다');
  }

  if (p.importance !== undefined && (typeof p.importance !== 'number' || !isValidImportance(p.importance))) {
    errors.push('importance는 0과 1 사이의 숫자여야 합니다');
  }

  if (p.privacy_scope && typeof p.privacy_scope === 'string' && !isValidPrivacyScope(p.privacy_scope)) {
    errors.push('privacy_scope는 private, team, public 중 하나여야 합니다');
  }

  if (p.tags && !Array.isArray(p.tags)) {
    errors.push('tags는 배열이어야 합니다');
  }

  if (p.always_load !== undefined && typeof p.always_load !== 'boolean') {
    errors.push('always_load는 boolean이어야 합니다');
  }

  if (p.immutable !== undefined && typeof p.immutable !== 'boolean') {
    errors.push('immutable은 boolean이어야 합니다');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 검색 파라미터 검증
 */
export function validateSearchParams(params: unknown): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof params !== 'object' || params === null) {
    return { isValid: false, errors: ['params는 객체여야 합니다'] };
  }

  const p = params as Record<string, unknown>;

  if (!p.query || typeof p.query !== 'string') {
    errors.push('query는 필수이며 문자열이어야 합니다');
  }

  if (p.limit !== undefined && (typeof p.limit !== 'number' || p.limit < 0)) {
    errors.push('limit은 0 이상의 숫자여야 합니다');
  }

  if (p.filters && typeof p.filters === 'object') {
    const filters = p.filters as Record<string, unknown>;
    if (filters.type && !Array.isArray(filters.type)) {
      errors.push('filters.type은 배열이어야 합니다');
    }

    if (filters.tags && !Array.isArray(filters.tags)) {
      errors.push('filters.tags는 배열이어야 합니다');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
