/**
 * Type Param Validator 테스트
 * 기본값/모드별 동작, 잘못된 타입 처리, trigger_conditions JSON 검증
 */

import { describe, it, expect } from 'vitest';
import {
  validateTypeParam,
  parseTypeParamMode,
  validateTriggerConditions,
  validateWorkflowOrSkillName,
  validateProceduralMemoryFields,
  type TypeParamMode
} from '../type-param-validator.js';

describe('Type Param Validator', () => {
  describe('validateTypeParam', () => {
    describe('유효한 타입 제공 시', () => {
      it('should return isValid=true for valid memory types', () => {
        // Given: 유효한 메모리 타입들
        const validTypes = ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'];

        // When: 각 타입 검증
        // Then: 모두 isValid=true 반환
        validTypes.forEach(type => {
          const result = validateTypeParam(type, 'warn', 'test-tool');
          expect(result.isValid).toBe(true);
          expect(result.defaultType).toBe(type.toLowerCase());
        });
      });

      it('should normalize case for valid types', () => {
        // Given: 대소문자가 섞인 유효한 타입
        const mixedCaseTypes = ['WORKING', 'Episodic', 'SEMANTIC', 'Procedural', 'CORE', 'Vault'];

        // When: 각 타입 검증
        // Then: 소문자로 정규화되어 반환
        mixedCaseTypes.forEach(type => {
          const result = validateTypeParam(type, 'warn', 'test-tool');
          expect(result.isValid).toBe(true);
          expect(result.defaultType).toBe(type.toLowerCase());
        });
      });

      it('should trim whitespace for valid types', () => {
        // Given: 공백이 포함된 유효한 타입
        const typesWithWhitespace = ['  working  ', ' episodic ', '\tsemantic\n'];

        // When: 각 타입 검증
        // Then: 공백 제거 후 검증
        typesWithWhitespace.forEach(type => {
          const result = validateTypeParam(type, 'warn', 'test-tool');
          expect(result.isValid).toBe(true);
          expect(result.defaultType).toBe(type.trim().toLowerCase());
        });
      });
    });

    describe('잘못된 타입 처리', () => {
      it('should return isValid=false for invalid memory types', () => {
        // Given: 유효하지 않은 메모리 타입들
        const invalidTypes = ['invalid', 'unknown', 'test', 'memory', 'item'];

        // When: 각 타입 검증
        // Then: 모두 isValid=false 반환
        invalidTypes.forEach(type => {
          const result = validateTypeParam(type, 'error', 'test-tool');
          expect(result.isValid).toBe(false);
          expect(result.message).toContain('유효하지 않습니다');
          expect(result.message).toContain('working');
        });
      });

      it('should include valid types in error message', () => {
        // Given: 유효하지 않은 타입
        const invalidType = 'invalid_type';

        // When: 검증
        const result = validateTypeParam(invalidType, 'error', 'test-tool');

        // Then: 에러 메시지에 지원되는 타입 목록 포함
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('working');
        expect(result.message).toContain('episodic');
        expect(result.message).toContain('semantic');
        expect(result.message).toContain('procedural');
      });

      it('should handle empty string as invalid when provided', () => {
        // Given: 빈 문자열
        const emptyString = '';

        // When: 검증 (빈 문자열은 undefined로 처리되어 기본값 사용)
        const result = validateTypeParam(emptyString, 'warn', 'test-tool');

        // Then: 빈 문자열은 undefined로 처리되어 기본값 반환
        expect(result.isValid).toBe(true);
        expect(result.defaultType).toBe('episodic');
      });
    });

    describe('타입 파라미터 없을 시 모드별 동작', () => {
      it('should return default episodic for warn mode', () => {
        // Given: type 파라미터 없음, warn 모드
        // When: 검증
        const result = validateTypeParam(undefined, 'warn', 'test-tool');

        // Then: 기본값 episodic 반환, 경고 메시지 포함
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('warn');
        expect(result.defaultType).toBe('episodic');
        expect(result.message).toContain('기본값');
        expect(result.message).toContain('episodic');
      });

      it('should return default episodic for deprecate mode', () => {
        // Given: type 파라미터 없음, deprecate 모드
        // When: 검증
        const result = validateTypeParam(undefined, 'deprecate', 'test-tool');

        // Then: 기본값 episodic 반환, Deprecation 경고 메시지 포함
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('deprecate');
        expect(result.defaultType).toBe('episodic');
        expect(result.message).toContain('필수');
        expect(result.message).toContain('마이그레이션');
      });

      it('should return isValid=false for error mode', () => {
        // Given: type 파라미터 없음, error 모드
        // When: 검증
        const result = validateTypeParam(undefined, 'error', 'test-tool');

        // Then: isValid=false, 에러 메시지 포함
        expect(result.isValid).toBe(false);
        expect(result.mode).toBe('error');
        expect(result.message).toContain('필수');
        expect(result.message).toContain('working');
      });

      it('should include tool name in messages', () => {
        // Given: tool name이 지정된 경우
        const toolName = 'remember-tool';

        // When: 검증
        const result = validateTypeParam(undefined, 'warn', toolName);

        // Then: 메시지에 tool name 포함
        expect(result.message).toContain(toolName);
      });

      it('should reject missing type for unknown mode', () => {
        // Given: 알 수 없는 모드 (타입 체크 우회를 위해 any 사용)
        const unknownMode = 'unknown' as any;

        // When: 검증
        const result = validateTypeParam(undefined, unknownMode, 'test-tool');

        // Then: error 모드로 처리
        expect(result.isValid).toBe(false);
        expect(result.mode).toBe('error');
        expect(result.message).toContain('필수');
      });
    });
  });

  describe('parseTypeParamMode', () => {
    it('should parse valid mode values', () => {
      // Given: 유효한 모드 값들
      const validModes: TypeParamMode[] = ['warn', 'deprecate', 'error'];

      // When: 각 모드 파싱
      // Then: 올바른 모드 반환
      validModes.forEach(mode => {
        expect(parseTypeParamMode(mode)).toBe(mode);
        expect(parseTypeParamMode(mode.toUpperCase())).toBe(mode);
        expect(parseTypeParamMode(`  ${mode}  `)).toBe(mode);
      });
    });

    it('should return error for undefined', () => {
      // Given: undefined
      // When: 파싱
      const result = parseTypeParamMode(undefined);

      // Then: 기본값 error 반환
      expect(result).toBe('error');
    });

    it('should return error for invalid values', () => {
      // Given: 유효하지 않은 값들
      const invalidValues = ['invalid', 'test', 'unknown', ''];

      // When: 각 값 파싱
      // Then: 모두 기본값 error 반환
      invalidValues.forEach(value => {
        const result = parseTypeParamMode(value);
        expect(result).toBe('error');
      });
    });

    it('should normalize case and whitespace', () => {
      // Given: 대소문자 혼합 및 공백 포함
      const mixedCases = ['WARN', 'Deprecate', '  ERROR  ', '\tWARN\n'];

      // When: 각 값 파싱
      // Then: 올바르게 정규화되어 반환
      expect(parseTypeParamMode(mixedCases[0])).toBe('warn');
      expect(parseTypeParamMode(mixedCases[1])).toBe('deprecate');
      expect(parseTypeParamMode(mixedCases[2])).toBe('error');
      expect(parseTypeParamMode(mixedCases[3])).toBe('warn');
    });
  });

  describe('validateTriggerConditions', () => {
    it('should pass for undefined', () => {
      // Given: undefined
      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateTriggerConditions(undefined)).not.toThrow();
    });

    it('should pass for null', () => {
      // Given: null
      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateTriggerConditions(null)).not.toThrow();
    });

    it('should pass for empty string', () => {
      // Given: 빈 문자열
      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateTriggerConditions('')).not.toThrow();
      expect(() => validateTriggerConditions('   ')).not.toThrow();
    });

    it('should pass for valid JSON object string', () => {
      // Given: 유효한 JSON 객체 문자열
      const validJsonObjects = [
        '{}',
        '{"key": "value"}',
        '{"error_type": "tool_error", "tool_name": "remember-tool"}',
        '{"nested": {"key": "value"}}'
      ];

      // When: 각 JSON 검증
      // Then: 모두 통과
      validJsonObjects.forEach(json => {
        expect(() => validateTriggerConditions(json)).not.toThrow();
      });
    });

    it('should throw for invalid JSON string', () => {
      // Given: 유효하지 않은 JSON 문자열
      const invalidJsonStrings = [
        '{invalid json}',
        '{"key": "value"',
        'not json',
        '[1, 2, 3]', // 배열은 객체가 아님
        '"string"', // 문자열은 객체가 아님
        '123' // 숫자는 객체가 아님
      ];

      // When: 각 JSON 검증
      // Then: 모두 에러 발생
      invalidJsonStrings.forEach(json => {
        expect(() => validateTriggerConditions(json)).toThrow();
      });
    });

    it('should throw for JSON array', () => {
      // Given: JSON 배열
      const jsonArray = '[1, 2, 3]';

      // When: 검증
      // Then: 에러 발생 (배열은 객체가 아님)
      expect(() => validateTriggerConditions(jsonArray)).toThrow('must be a valid JSON object');
    });

    it('should throw for JSON primitive values', () => {
      // Given: JSON 원시 값들
      const primitives = ['"string"', '123', 'true', 'false', 'null'];

      // When: 각 값 검증
      // Then: 모두 에러 발생
      primitives.forEach(primitive => {
        expect(() => validateTriggerConditions(primitive)).toThrow('must be a valid JSON object');
      });
    });

    it('should throw TypeError for non-string input', () => {
      // Given: 비문자열 입력들
      const nonStrings = [123, {}, [], true, null, undefined];

      // When: 각 값 검증 (undefined와 null은 예외)
      // Then: TypeError 발생
      expect(() => validateTriggerConditions(123 as any)).toThrow(TypeError);
      expect(() => validateTriggerConditions({} as any)).toThrow(TypeError);
      expect(() => validateTriggerConditions([] as any)).toThrow(TypeError);
      expect(() => validateTriggerConditions(true as any)).toThrow(TypeError);
      
      // undefined와 null은 통과
      expect(() => validateTriggerConditions(undefined)).not.toThrow();
      expect(() => validateTriggerConditions(null)).not.toThrow();
    });

    it('should include helpful error message for non-string', () => {
      // Given: 비문자열 입력
      const nonString = { key: 'value' };

      // When: 검증
      // Then: 명시적 에러 메시지 포함
      expect(() => validateTriggerConditions(nonString as any)).toThrow(
        'trigger_conditions must be a string'
      );
    });
  });

  describe('validateWorkflowOrSkillName', () => {
    it('should pass for undefined', () => {
      // Given: undefined
      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateWorkflowOrSkillName(undefined, 'workflow_name')).not.toThrow();
      expect(() => validateWorkflowOrSkillName(undefined, 'skill_name')).not.toThrow();
    });

    it('should pass for null', () => {
      // Given: null
      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateWorkflowOrSkillName(null, 'workflow_name')).not.toThrow();
    });

    it('should pass for valid non-empty strings', () => {
      // Given: 유효한 비어있지 않은 문자열들
      const validStrings = ['데이터 마이그레이션', 'API 배포', 'test', 'a'];

      // When: 각 문자열 검증
      // Then: 모두 통과
      validStrings.forEach(str => {
        expect(() => validateWorkflowOrSkillName(str, 'workflow_name')).not.toThrow();
        expect(() => validateWorkflowOrSkillName(str, 'skill_name')).not.toThrow();
      });
    });

    it('should throw for empty string', () => {
      // Given: 빈 문자열들
      const emptyStrings = ['', '   ', '\t\n'];

      // When: 각 문자열 검증
      // Then: 모두 에러 발생
      emptyStrings.forEach(str => {
        expect(() => validateWorkflowOrSkillName(str, 'workflow_name')).toThrow();
        expect(() => validateWorkflowOrSkillName(str, 'skill_name')).toThrow();
      });
    });

    it('should include field name in error message', () => {
      // Given: 빈 문자열
      const emptyString = '';

      // When: workflow_name 검증
      // Then: 에러 메시지에 workflow_name 포함
      expect(() => validateWorkflowOrSkillName(emptyString, 'workflow_name')).toThrow(
        'workflow_name'
      );

      // When: skill_name 검증
      // Then: 에러 메시지에 skill_name 포함
      expect(() => validateWorkflowOrSkillName(emptyString, 'skill_name')).toThrow('skill_name');
    });

    it('should throw for non-string types', () => {
      // Given: 비문자열 타입들
      const nonStrings = [
        123, // number
        {}, // object
        [], // array
        true, // boolean
        null, // null (이미 테스트됨)
        undefined // undefined (이미 테스트됨)
      ];

      // When: 각 비문자열 타입 검증 (null과 undefined 제외)
      // Then: 모두 에러 발생
      expect(() => validateWorkflowOrSkillName(123 as any, 'workflow_name')).toThrow('must be a string');
      expect(() => validateWorkflowOrSkillName({} as any, 'workflow_name')).toThrow('must be a string');
      expect(() => validateWorkflowOrSkillName([] as any, 'workflow_name')).toThrow('must be a string');
      expect(() => validateWorkflowOrSkillName(true as any, 'workflow_name')).toThrow('must be a string');
      
      // null과 undefined는 통과 (optional 필드)
      expect(() => validateWorkflowOrSkillName(null, 'workflow_name')).not.toThrow();
      expect(() => validateWorkflowOrSkillName(undefined, 'workflow_name')).not.toThrow();
    });

    it('should include value in error message for non-string types', () => {
      // Given: 비문자열 타입
      const nonString = 12345;

      // When: 검증
      // Then: 에러 메시지에 타입과 값 포함
      expect(() => validateWorkflowOrSkillName(nonString as any, 'workflow_name')).toThrow(
        'must be a string, but got number'
      );
      expect(() => validateWorkflowOrSkillName(nonString as any, 'workflow_name')).toThrow('12345');
    });
  });

  describe('validateProceduralMemoryFields', () => {
    it('should pass for all valid fields', () => {
      // Given: 모든 필드가 유효한 경우
      const validParams = {
        workflow_name: '데이터 마이그레이션',
        skill_name: '스키마 백업',
        trigger_conditions: '{"error_type": "tool_error"}'
      };

      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateProceduralMemoryFields(validParams)).not.toThrow();
    });

    it('should pass for all optional fields undefined', () => {
      // Given: 모든 필드가 undefined
      const emptyParams = {
        workflow_name: undefined,
        skill_name: undefined,
        trigger_conditions: undefined
      };

      // When: 검증
      // Then: 에러 없이 통과
      expect(() => validateProceduralMemoryFields(emptyParams)).not.toThrow();
    });

    it('should throw for empty workflow_name', () => {
      // Given: workflow_name이 빈 문자열
      const invalidParams = {
        workflow_name: '',
        skill_name: 'valid',
        trigger_conditions: '{}'
      };

      // When: 검증
      // Then: 에러 발생
      expect(() => validateProceduralMemoryFields(invalidParams)).toThrow('workflow_name');
    });

    it('should throw for empty skill_name', () => {
      // Given: skill_name이 빈 문자열
      const invalidParams = {
        workflow_name: 'valid',
        skill_name: '',
        trigger_conditions: '{}'
      };

      // When: 검증
      // Then: 에러 발생
      expect(() => validateProceduralMemoryFields(invalidParams)).toThrow('skill_name');
    });

    it('should throw for invalid trigger_conditions JSON', () => {
      // Given: 유효하지 않은 trigger_conditions JSON
      const invalidParams = {
        workflow_name: 'valid',
        skill_name: 'valid',
        trigger_conditions: 'invalid json'
      };

      // When: 검증
      // Then: 에러 발생
      expect(() => validateProceduralMemoryFields(invalidParams)).toThrow('trigger_conditions');
    });

    it('should throw for trigger_conditions as array', () => {
      // Given: trigger_conditions가 배열 JSON
      const invalidParams = {
        workflow_name: 'valid',
        skill_name: 'valid',
        trigger_conditions: '[1, 2, 3]'
      };

      // When: 검증
      // Then: 에러 발생
      expect(() => validateProceduralMemoryFields(invalidParams)).toThrow('trigger_conditions');
    });

    it('should throw TypeError for non-string trigger_conditions', () => {
      // Given: trigger_conditions가 비문자열
      const invalidParams = {
        workflow_name: 'valid',
        skill_name: 'valid',
        trigger_conditions: { key: 'value' } as any
      };

      // When: 검증
      // Then: TypeError 발생
      expect(() => validateProceduralMemoryFields(invalidParams)).toThrow(TypeError);
    });

    it('should validate all fields together', () => {
      // Given: 여러 필드가 유효하지 않은 경우
      const invalidParams = {
        workflow_name: '',
        skill_name: '',
        trigger_conditions: 'invalid'
      };

      // When: 검증
      // Then: 첫 번째 에러 발생 (workflow_name)
      expect(() => validateProceduralMemoryFields(invalidParams)).toThrow('workflow_name');
    });
  });
});

