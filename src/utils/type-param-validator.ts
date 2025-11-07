/**
 * type 파라미터 롤아웃 모드 검증 유틸리티
 * 
 * Phase 1 (warn): type 파라미터 없을 시 경고 로그 출력 및 기본값 적용
 * Phase 2 (deprecate): type 파라미터 없을 시 Deprecation 경고 및 기본값 적용
 * Phase 3 (error): type 파라미터 없을 시 에러 발생
 */

export type TypeParamMode = 'warn' | 'deprecate' | 'error';

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
    return {
      isValid: true,
      mode,
      defaultType: type
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
        message: `⚠️  [DEPRECATED] ${toolName}: 'type' 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다. 'type' 파라미터는 필수로 지정해주세요. 마이그레이션 가이드: https://github.com/your-repo/memento/blob/main/docs/migration-guide.md`,
        defaultType
      };

    case 'error':
      return {
        isValid: false,
        mode: 'error',
        message: `❌ ${toolName}: 'type' 파라미터는 필수입니다. 'core' | 'episodic' | 'semantic' | 'procedural' | 'vault' | 'working' 중 하나를 지정해주세요.`
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

