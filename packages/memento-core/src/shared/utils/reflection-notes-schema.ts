/**
 * Reflection Notes JSON 스키마 검증 유틸리티
 * 
 * reflection_notes 필드의 JSON 스키마를 검증하는 유틸리티 함수를 제공합니다.
 * 단일 객체 또는 배열 형식 모두 지원합니다.
 */

import { z } from 'zod';

/**
 * ISO 8601 형식의 날짜 문자열 검증
 * 예: "2025-01-01T00:00:00Z", "2025-01-01T00:00:00.000Z"
 */
const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * Reflection Note 스키마 정의
 * 
 * 필수 필드:
 * - failure_type: 실패 유형 (tool_error | user_feedback | metric_failure)
 * - failure_description: 실패에 대한 상세 설명 (최대 5000자)
 * - timestamp: Reflexion 기록 시각 (ISO 8601 형식)
 * 
 * 옵션 필드:
 * - original_task: 원래 수행하려던 작업 (최대 2000자)
 * - lessons_learned: 학습한 교훈 (최대 5000자)
 * - suggested_improvements: 제안하는 개선 방안 (최대 5000자)
 * - phase: 기록 방식 (manual | auto, 기본값: manual)
 */
export const ReflectionNoteSchema = z.object({
  failure_type: z.enum(['tool_error', 'user_feedback', 'metric_failure'], {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return {
          message: `failure_type는 'tool_error', 'user_feedback', 'metric_failure' 중 하나여야 합니다. 현재 값: ${ctx.data}`
        };
      }
      return { message: ctx.defaultError };
    }
  }),
  failure_description: z.string()
    .min(1, 'failure_description은 비어있을 수 없습니다')
    .max(5000, 'failure_description은 최대 5000자를 초과할 수 없습니다'),
  timestamp: z.string()
    .min(1, 'timestamp는 필수입니다')
    .refine(
      (val) => iso8601Regex.test(val),
      {
        message: 'timestamp는 ISO 8601 형식이어야 합니다 (예: 2025-01-01T00:00:00Z)'
      }
    )
    .refine(
      (val) => {
        // 실제로 유효한 날짜인지 확인
        const date = new Date(val);
        return !isNaN(date.getTime());
      },
      {
        message: 'timestamp는 유효한 날짜여야 합니다'
      }
    ),
  original_task: z.string()
    .max(2000, 'original_task는 최대 2000자를 초과할 수 없습니다')
    .optional(),
  lessons_learned: z.string()
    .max(5000, 'lessons_learned는 최대 5000자를 초과할 수 없습니다')
    .optional(),
  suggested_improvements: z.string()
    .max(5000, 'suggested_improvements는 최대 5000자를 초과할 수 없습니다')
    .optional(),
  /** Reflexion 등에서 선택적으로 기록 */
  tool_name: z.string().optional(),
  phase: z.enum(['manual', 'auto'], {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return {
          message: `phase는 'manual' 또는 'auto'여야 합니다. 현재 값: ${ctx.data}`
        };
      }
      return { message: ctx.defaultError };
    }
  }).default('manual')
});

/**
 * Reflection Note 타입 정의
 */
export type ReflectionNote = z.infer<typeof ReflectionNoteSchema>;

/**
 * 검증 결과 타입
 */
export interface ValidationResult {
  isValid: boolean;
  errors?: Array<{
    field: string;
    expected: string;
    actual: unknown;
    message: string;
  }>;
}

/**
 * 단일 Reflection Note 객체 검증
 * 
 * @param data - 검증할 객체
 * @returns 검증 결과
 */
export function validateReflectionNote(data: unknown): ValidationResult {
  try {
    ReflectionNoteSchema.parse(data);
    return { isValid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((err) => {
        const path = err.path.join('.');
        return {
          field: path || 'root',
          expected: err.code === z.ZodIssueCode.invalid_enum_value
            ? `enum 값 중 하나 (${err.options?.join(', ')})`
            : err.code === z.ZodIssueCode.invalid_type
            ? err.expected
            : '유효한 값',
          actual: err.path.length > 0 ? err.path.reduce((obj: unknown, key) => (obj as Record<string | number, unknown>)?.[key], data) : data,
          message: err.message
        };
      });
      return { isValid: false, errors };
    }
    return {
      isValid: false,
      errors: [{
        field: 'root',
        expected: '유효한 Reflection Note 객체',
        actual: data,
        message: error instanceof Error ? error.message : String(error)
      }]
    };
  }
}

/**
 * 단일 객체 또는 배열 형식 모두 지원하는 검증 함수
 * 
 * @param jsonString - 검증할 JSON 문자열
 * @returns 검증 결과
 */
export function validateReflectionNotes(jsonString: string): ValidationResult {
  if (!jsonString || jsonString.trim() === '') {
    return {
      isValid: false,
      errors: [{
        field: 'root',
        expected: '비어있지 않은 JSON 문자열',
        actual: jsonString,
        message: 'reflection_notes는 빈 문자열일 수 없습니다'
      }]
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    return {
      isValid: false,
      errors: [{
        field: 'root',
        expected: '유효한 JSON 형식',
        actual: jsonString,
        message: `JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  }

  // 배열인 경우
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return {
        isValid: false,
        errors: [{
          field: 'root',
          expected: '최소 1개 이상의 요소를 포함한 배열',
          actual: parsed,
          message: 'reflection_notes 배열은 최소 1개 이상의 요소를 포함해야 합니다'
        }]
      };
    }

    // 배열의 각 요소 검증
    const allErrors: Array<{ field: string; expected: string; actual: unknown; message: string }> = [];
    parsed.forEach((item, index) => {
      const result = validateReflectionNote(item);
      if (!result.isValid && result.errors) {
        // 인덱스를 필드 경로에 추가
        result.errors.forEach((err) => {
          allErrors.push({
            field: `[${index}].${err.field}`,
            expected: err.expected,
            actual: err.actual,
            message: err.message
          });
        });
      }
    });

    if (allErrors.length > 0) {
      return {
        isValid: false,
        errors: allErrors
      };
    }

    return { isValid: true };
  }

  // 단일 객체인 경우
  if (typeof parsed === 'object' && parsed !== null) {
    return validateReflectionNote(parsed);
  }

  // 객체나 배열이 아닌 경우
  return {
    isValid: false,
    errors: [{
      field: 'root',
      expected: 'JSON 객체 또는 배열',
      actual: typeof parsed,
      message: `reflection_notes는 JSON 객체 또는 배열이어야 합니다. 현재 타입: ${typeof parsed}`
    }]
  };
}

/**
 * 검증 결과를 사람이 읽기 쉬운 에러 메시지로 변환
 * 
 * @param result - 검증 결과
 * @returns 에러 메시지 문자열
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.isValid || !result.errors) {
    return '';
  }

  const messages = result.errors.map((err) => {
    const actualStr = typeof err.actual === 'object' 
      ? JSON.stringify(err.actual).substring(0, 100)
      : String(err.actual).substring(0, 100);
    return `필드 '${err.field}': ${err.message} (기대값: ${err.expected}, 실제값: ${actualStr})`;
  });

  return messages.join('\n');
}

