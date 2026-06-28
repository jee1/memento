/**
 * type 파라미터 롤아웃 모드 검증 유틸리티
 * 
 * Phase 1 (warn): type 파라미터 없을 시 경고 로그 출력 및 기본값 적용
 * Phase 2 (deprecate): type 파라미터 없을 시 Deprecation 경고 및 기본값 적용
 * Phase 3 (error): type 파라미터 없을 시 에러 발생
 */

export type TypeParamMode = 'warn' | 'deprecate' | 'error';

/**
 * 지원되는 메모리 타입 whitelist
 * MemoryTypeRequest: 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault'
 */
const VALID_MEMORY_TYPES = ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] as const;

export interface TypeParamValidationResult {
  isValid: boolean;
  mode: TypeParamMode;
  message?: string;
  defaultType?: string;
}

/**
 * type 파라미터 검증 및 롤아웃 모드에 따른 처리
 * 
 * @param type - 사용자가 제공한 type 파라미터 (없을 수 있음)
 * @param mode - 롤아웃 모드 ('warn' | 'deprecate' | 'error')
 * @param toolName - 도구 이름 (에러 메시지에 사용)
 * @returns 검증 결과 및 기본값
 */
export function validateTypeParam(
  type: string | undefined,
  mode: TypeParamMode,
  toolName: string = 'tool'
): TypeParamValidationResult {
  // type 파라미터가 제공된 경우
  if (type !== undefined && type !== null && type !== '') {
    // whitelist 검증: 지원되는 타입인지 확인
    const normalizedType = type.toLowerCase().trim();
    if (!VALID_MEMORY_TYPES.includes(normalizedType as any)) {
      return {
        isValid: false,
        mode: 'error',
        message: `❌ ${toolName}: 'type' 파라미터 값 '${type}'이(가) 유효하지 않습니다. 지원되는 타입: ${VALID_MEMORY_TYPES.join(' | ')}`
      };
    }
    
    return {
      isValid: true,
      mode,
      defaultType: normalizedType
    };
  }

  // type 파라미터가 없는 경우 - 모드에 따라 처리
  const defaultType = 'episodic'; // 기본값

  switch (mode) {
    case 'warn':
      return {
        isValid: true,
        mode: 'warn',
        message: `⚠️  ${toolName}: 'type' 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다. 향후 버전에서는 필수 파라미터가 됩니다.`,
        defaultType
      };

    case 'deprecate':
      return {
        isValid: true,
        mode: 'deprecate',
        message: `⚠️  [LEGACY TYPE] ${toolName}: 'type' 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다. 'type' 파라미터는 필수로 지정해주세요. 마이그레이션 가이드: https://github.com/jee1/memento/blob/main/docs/guides/ko/type-param-rollout.md`,
        defaultType
      };

    case 'error':
      return {
        isValid: false,
        mode: 'error',
        message: `❌ ${toolName}: 'type' 파라미터는 필수입니다. 지원되는 타입: ${VALID_MEMORY_TYPES.join(' | ')}`
      };

    default:
      // 알 수 없는 모드인 경우 warn 모드로 처리
      return {
        isValid: true,
        mode: 'warn',
        message: `⚠️  ${toolName}: 'type' 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다.`,
        defaultType
      };
  }
}

/**
 * 환경 변수에서 롤아웃 모드 읽기
 * 
 * @param envValue - 환경 변수 값
 * @returns 유효한 모드 또는 기본값 'warn'
 */
export function parseTypeParamMode(envValue: string | undefined): TypeParamMode {
  if (!envValue) {
    return 'warn';
  }

  const normalized = envValue.toLowerCase().trim();
  if (normalized === 'warn' || normalized === 'deprecate' || normalized === 'error') {
    return normalized as TypeParamMode;
  }

  // 유효하지 않은 값인 경우 기본값 반환
  console.warn(`⚠️  Invalid MEMENTO_TYPE_PARAM_MODE value: ${envValue}. Using default 'warn'.`);
  return 'warn';
}

/**
 * Procedural Memory Enhancement (v7.0) 필드 검증 유틸리티
 */

/**
 * trigger_conditions JSON 검증
 * 
 * @param triggerConditions - 검증할 trigger_conditions 문자열 (JSON 객체 문자열)
 * @returns 검증 성공 여부
 * @throws {Error} 유효하지 않은 JSON이거나 객체가 아닌 경우
 */
export function validateTriggerConditions(triggerConditions: string | undefined | null): void {
  // undefined 또는 null인 경우 통과 (optional 필드)
  if (triggerConditions === undefined || triggerConditions === null) {
    return;
  }

  // 타입 안전성 체크: 문자열이 아니면 명시적 에러
  if (typeof triggerConditions !== 'string') {
    throw new TypeError(
      `trigger_conditions must be a string, but received ${typeof triggerConditions}. ` +
      `If you need to pass an object, stringify it first: JSON.stringify(yourObject)`
    );
  }

  // 빈 문자열인 경우 통과 (optional 필드)
  if (triggerConditions.trim() === '') {
    return;
  }

  try {
    const parsed = JSON.parse(triggerConditions);
    
    // 객체인지 확인
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('trigger_conditions must be a valid JSON object, not an array or primitive value');
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`trigger_conditions must be a valid JSON object string: ${error.message}`);
    }
    throw error;
  }
}

/**
 * workflow_name 또는 skill_name 빈 문자열 방지 검증
 * 
 * @param value - 검증할 값
 * @param fieldName - 필드 이름 (에러 메시지에 사용)
 * @returns 검증 성공 여부
 * @throws {Error} 빈 문자열이거나 비문자열 타입인 경우
 */
export function validateWorkflowOrSkillName(
  value: string | undefined | null,
  fieldName: 'workflow_name' | 'skill_name'
): void {
  // undefined 또는 null인 경우 통과 (optional 필드)
  if (value === undefined || value === null) {
    return;
  }

  // 문자열 타입이 아닌 경우 에러 (number, object 등이 들어오는 경우 방지)
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string, but got ${typeof value}. Value: ${JSON.stringify(value)}`);
  }

  // 빈 문자열인 경우 에러
  if (value.trim() === '') {
    throw new Error(`${fieldName} cannot be an empty string. Provide a valid value or omit the field.`);
  }
}

/**
 * RememberParams의 Procedural Memory Enhancement 필드 검증
 * 
 * @param params - 검증할 RememberParams 객체
 * @throws {Error} 검증 실패 시
 */
export function validateProceduralMemoryFields(params: {
  workflow_name?: string | null;
  skill_name?: string | null;
  trigger_conditions?: string | null;
}): void {
  // workflow_name 검증
  validateWorkflowOrSkillName(params.workflow_name, 'workflow_name');

  // skill_name 검증
  validateWorkflowOrSkillName(params.skill_name, 'skill_name');

  // trigger_conditions JSON 검증
  validateTriggerConditions(params.trigger_conditions);
}

