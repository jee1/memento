/** type parameter validation: type is required (#636, modes removed in #1242). */

/**
 * 지원되는 메모리 타입 whitelist
 * MemoryTypeRequest: 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault'
 */
const VALID_MEMORY_TYPES = ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] as const;
type ValidMemoryType = typeof VALID_MEMORY_TYPES[number];

function isValidMemoryType(type: string): type is ValidMemoryType {
  return (VALID_MEMORY_TYPES as readonly string[]).includes(type);
}

interface TypeParamValidationResult {
  isValid: boolean;
  message?: string;
  defaultType?: string;
}

/**
 * type 파라미터 검증
 *
 * @param type - 사용자가 제공한 type 파라미터 (없을 수 있음)
 * @param toolName - 도구 이름 (에러 메시지에 사용)
 * @returns 검증 결과 및 정규화된 타입
 */
export function validateTypeParam(
  type: string | undefined,
  toolName: string = 'tool'
): TypeParamValidationResult {
  if (type !== undefined && type !== null && type !== '') {
    const normalizedType = type.toLowerCase().trim();
    if (!isValidMemoryType(normalizedType)) {
      return {
        isValid: false,
        message: `❌ ${toolName}: 'type' 파라미터 값 '${type}'이(가) 유효하지 않습니다. 지원되는 타입: ${VALID_MEMORY_TYPES.join(' | ')}`
      };
    }

    return {
      isValid: true,
      defaultType: normalizedType
    };
  }

  return {
    isValid: false,
    message: `❌ ${toolName}: 'type' 파라미터는 필수입니다. 지원되는 타입: ${VALID_MEMORY_TYPES.join(' | ')}`
  };
}

/**
 * MCP inputSchema 가 광고하는 type 필수 제약 (#853).
 *
 * @returns inputSchema.required 에 넣을 필드 목록
 */
export function typeParamRequiredFields(): string[] {
  return ['type'];
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
