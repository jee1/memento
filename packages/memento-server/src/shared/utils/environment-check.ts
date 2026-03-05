/**
 * 설정 검증을 건너뛸 수 있는 환경인지 확인
 * - 테스트나 빌드 단계에서는 실제 환경 변수가 세팅되지 않을 수 있으므로 선택적으로 검증을 스킵
 */

const SKIP_VALIDATION_FLAGS = new Set(['true', '1', 'yes', 'on']);

export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

export function isValidationDisabled(): boolean {
  const raw = process.env.DISABLE_CONFIG_VALIDATION ?? process.env.SKIP_CONFIG_VALIDATION;
  if (!raw) {
    return false;
  }
  return SKIP_VALIDATION_FLAGS.has(raw.toLowerCase());
}

export function isValidConfigurationEnvironment(): boolean {
  if (isTestEnvironment()) {
    return false;
  }
  if (isValidationDisabled()) {
    return false;
  }
  return true;
}
