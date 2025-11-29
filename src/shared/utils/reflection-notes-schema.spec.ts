import { describe, it, expect } from 'vitest';
import {
  validateReflectionNote,
  validateReflectionNotes,
  formatValidationErrors,
  ReflectionNoteSchema,
  type ReflectionNote
} from '../reflection-notes-schema.js';

describe('Reflection Notes Schema Validation', () => {
  describe('validateReflectionNote - 단일 객체 검증', () => {
    it('should validate valid reflection note with all required fields', () => {
      const validNote: ReflectionNote = {
        failure_type: 'tool_error',
        failure_description: 'Tool execution failed',
        timestamp: '2025-01-01T00:00:00Z'
      };

      const result = validateReflectionNote(validNote);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate valid reflection note with all fields', () => {
      const validNote: ReflectionNote = {
        failure_type: 'user_feedback',
        failure_description: 'User reported issue',
        timestamp: '2025-01-01T00:00:00.000Z',
        original_task: 'Complete task X',
        lessons_learned: 'Need better error handling',
        suggested_improvements: 'Add retry logic',
        phase: 'manual'
      };

      const result = validateReflectionNote(validNote);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    describe('필수 필드 검증', () => {
      it('should reject missing failure_type', () => {
        const invalidNote = {
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.field === 'failure_type')).toBe(true);
      });

      it('should reject missing failure_description', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.field === 'failure_description')).toBe(true);
      });

      it('should reject missing timestamp', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.field === 'timestamp')).toBe(true);
      });
    });

    describe('타입 제약 검증', () => {
      it('should reject non-string failure_description', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 123,
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.field === 'failure_description')).toBe(true);
      });

      it('should reject non-string timestamp', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: 1234567890
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.field === 'timestamp')).toBe(true);
      });
    });

    describe('최대 길이 검증', () => {
      it('should reject failure_description exceeding 5000 characters', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'a'.repeat(5001),
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'failure_description' && 
          err.message.includes('5000자')
        )).toBe(true);
      });

      it('should accept failure_description with exactly 5000 characters', () => {
        const validNote = {
          failure_type: 'tool_error',
          failure_description: 'a'.repeat(5000),
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(validNote);
        expect(result.isValid).toBe(true);
      });

      it('should reject original_task exceeding 2000 characters', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z',
          original_task: 'a'.repeat(2001)
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'original_task' && 
          err.message.includes('2000자')
        )).toBe(true);
      });

      it('should accept original_task with exactly 2000 characters', () => {
        const validNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z',
          original_task: 'a'.repeat(2000)
        };

        const result = validateReflectionNote(validNote);
        expect(result.isValid).toBe(true);
      });

      it('should reject lessons_learned exceeding 5000 characters', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z',
          lessons_learned: 'a'.repeat(5001)
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'lessons_learned' && 
          err.message.includes('5000자')
        )).toBe(true);
      });

      it('should reject suggested_improvements exceeding 5000 characters', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z',
          suggested_improvements: 'a'.repeat(5001)
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'suggested_improvements' && 
          err.message.includes('5000자')
        )).toBe(true);
      });
    });

    describe('enum 값 검증', () => {
      it('should reject invalid failure_type', () => {
        const invalidNote = {
          failure_type: 'invalid_type',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'failure_type' && 
          err.message.includes('tool_error') &&
          err.message.includes('user_feedback') &&
          err.message.includes('metric_failure')
        )).toBe(true);
      });

      it('should accept valid failure_type values', () => {
        const types = ['tool_error', 'user_feedback', 'metric_failure'] as const;
        
        for (const type of types) {
          const validNote = {
            failure_type: type,
            failure_description: 'Test',
            timestamp: '2025-01-01T00:00:00Z'
          };

          const result = validateReflectionNote(validNote);
          expect(result.isValid).toBe(true);
        }
      });

      it('should reject invalid phase', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z',
          phase: 'invalid_phase'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'phase' && 
          err.message.includes('manual') &&
          err.message.includes('auto')
        )).toBe(true);
      });

      it('should accept valid phase values', () => {
        const phases = ['manual', 'auto'] as const;
        
        for (const phase of phases) {
          const validNote = {
            failure_type: 'tool_error',
            failure_description: 'Test',
            timestamp: '2025-01-01T00:00:00Z',
            phase
          };

          const result = validateReflectionNote(validNote);
          expect(result.isValid).toBe(true);
        }
      });

      it('should default phase to manual when not provided', () => {
        const note = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const parsed = ReflectionNoteSchema.parse(note);
        expect(parsed.phase).toBe('manual');
      });
    });

    describe('timestamp ISO 8601 형식 검증', () => {
      it('should accept valid ISO 8601 timestamp without milliseconds', () => {
        const validNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(validNote);
        expect(result.isValid).toBe(true);
      });

      it('should accept valid ISO 8601 timestamp with milliseconds', () => {
        const validNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00.000Z'
        };

        const result = validateReflectionNote(validNote);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid timestamp format', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-01-01'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'timestamp' && 
          err.message.includes('ISO 8601')
        )).toBe(true);
      });

      it('should reject invalid date', () => {
        const invalidNote = {
          failure_type: 'tool_error',
          failure_description: 'Test',
          timestamp: '2025-13-45T00:00:00Z' // 유효하지 않은 날짜
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => 
          err.field === 'timestamp' && 
          err.message.includes('유효한 날짜')
        )).toBe(true);
      });
    });

    describe('에러 메시지 포맷', () => {
      it('should include field name in error message', () => {
        const invalidNote = {
          failure_type: 'invalid',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.field === 'failure_type')).toBe(true);
      });

      it('should include expected value in error message', () => {
        const invalidNote = {
          failure_type: 'invalid',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        const error = result.errors?.find(err => err.field === 'failure_type');
        expect(error?.expected).toBeDefined();
      });

      it('should include actual value in error message', () => {
        const invalidNote = {
          failure_type: 'invalid',
          failure_description: 'Test',
          timestamp: '2025-01-01T00:00:00Z'
        };

        const result = validateReflectionNote(invalidNote);
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        const error = result.errors?.find(err => err.field === 'failure_type');
        expect(error?.actual).toBe('invalid');
      });
    });
  });

  describe('validateReflectionNotes - JSON 문자열 검증 (단일 객체 및 배열)', () => {
    it('should validate valid single object JSON string', () => {
      const validJson = JSON.stringify({
        failure_type: 'tool_error',
        failure_description: 'Test',
        timestamp: '2025-01-01T00:00:00Z'
      });

      const result = validateReflectionNotes(validJson);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate valid array JSON string', () => {
      const validJson = JSON.stringify([
        {
          failure_type: 'tool_error',
          failure_description: 'Test 1',
          timestamp: '2025-01-01T00:00:00Z'
        },
        {
          failure_type: 'user_feedback',
          failure_description: 'Test 2',
          timestamp: '2025-01-02T00:00:00Z'
        }
      ]);

      const result = validateReflectionNotes(validJson);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject empty string', () => {
      const result = validateReflectionNotes('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(err => 
        err.message.includes('빈 문자열')
      )).toBe(true);
    });

    it('should reject invalid JSON string', () => {
      const result = validateReflectionNotes('{ invalid json }');
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(err => 
        err.message.includes('JSON 파싱 실패')
      )).toBe(true);
    });

    it('should reject empty array', () => {
      const result = validateReflectionNotes('[]');
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(err => 
        err.message.includes('최소 1개 이상')
      )).toBe(true);
    });

    it('should reject non-object and non-array values', () => {
      const result = validateReflectionNotes('"string"');
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(err => 
        err.message.includes('JSON 객체 또는 배열')
      )).toBe(true);
    });

    it('should validate array with multiple valid items', () => {
      const validJson = JSON.stringify([
        {
          failure_type: 'tool_error',
          failure_description: 'Error 1',
          timestamp: '2025-01-01T00:00:00Z',
          phase: 'manual'
        },
        {
          failure_type: 'user_feedback',
          failure_description: 'Error 2',
          timestamp: '2025-01-02T00:00:00Z',
          phase: 'auto',
          original_task: 'Task X',
          lessons_learned: 'Lesson Y',
          suggested_improvements: 'Improvement Z'
        }
      ]);

      const result = validateReflectionNotes(validJson);
      expect(result.isValid).toBe(true);
    });

    it('should reject array with invalid item', () => {
      const invalidJson = JSON.stringify([
        {
          failure_type: 'tool_error',
          failure_description: 'Valid',
          timestamp: '2025-01-01T00:00:00Z'
        },
        {
          failure_type: 'invalid_type', // Invalid
          failure_description: 'Invalid',
          timestamp: '2025-01-02T00:00:00Z'
        }
      ]);

      const result = validateReflectionNotes(invalidJson);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(err => 
        err.field.includes('[1]') && err.field.includes('failure_type')
      )).toBe(true);
    });
  });

  describe('formatValidationErrors', () => {
    it('should return empty string for valid result', () => {
      const result = { isValid: true };
      const formatted = formatValidationErrors(result);
      expect(formatted).toBe('');
    });

    it('should format single error message', () => {
      const result = {
        isValid: false,
        errors: [{
          field: 'failure_type',
          expected: 'enum 값 중 하나',
          actual: 'invalid',
          message: 'failure_type는 유효한 enum 값이어야 합니다'
        }]
      };

      const formatted = formatValidationErrors(result);
      expect(formatted).toContain('failure_type');
      expect(formatted).toContain('enum 값 중 하나');
      expect(formatted).toContain('invalid');
    });

    it('should format multiple error messages', () => {
      const result = {
        isValid: false,
        errors: [
          {
            field: 'failure_type',
            expected: 'enum 값 중 하나',
            actual: 'invalid',
            message: 'failure_type는 유효한 enum 값이어야 합니다'
          },
          {
            field: 'timestamp',
            expected: 'ISO 8601 형식',
            actual: 'invalid',
            message: 'timestamp는 ISO 8601 형식이어야 합니다'
          }
        ]
      };

      const formatted = formatValidationErrors(result);
      expect(formatted).toContain('failure_type');
      expect(formatted).toContain('timestamp');
      expect(formatted.split('\n').length).toBe(2);
    });

    it('should truncate long actual values', () => {
      const longValue = 'a'.repeat(200);
      const result = {
        isValid: false,
        errors: [{
          field: 'failure_description',
          expected: 'string',
          actual: longValue,
          message: 'failure_description은 문자열이어야 합니다'
        }]
      };

      const formatted = formatValidationErrors(result);
      expect(formatted).toContain('failure_description');
      // 100자로 제한되므로 전체 문자열이 포함되지 않아야 함
      expect(formatted.length).toBeLessThan(longValue.length);
    });
  });
});

