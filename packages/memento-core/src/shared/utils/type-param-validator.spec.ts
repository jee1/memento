import { describe, it, expect } from 'vitest';
import { validateTypeParam } from './type-param-validator.js';

describe('type-param-validator', () => {
  describe('validateTypeParam', () => {
    it('should return valid result when type is provided', () => {
      const result = validateTypeParam('episodic', 'test-tool');

      expect(result.isValid).toBe(true);
      expect(result.defaultType).toBe('episodic');
      expect(result.message).toBeUndefined();
    });

    it('should return invalid result when type is invalid', () => {
      const result = validateTypeParam('invalid_type', 'test-tool');

      expect(result.isValid).toBe(false);
      expect(result.message).toContain('유효하지 않습니다');
      expect(result.message).toContain('working');
    });

    it('should return invalid result when type is undefined', () => {
      const result = validateTypeParam(undefined, 'test-tool');

      expect(result.isValid).toBe(false);
      expect(result.message).toContain('필수');
      expect(result.message).toContain('type');
    });

    it('should return invalid result when type is empty string', () => {
      const result = validateTypeParam('', 'test-tool');

      expect(result.isValid).toBe(false);
      expect(result.message).toContain('필수');
    });

    it('should include valid type options in error message', () => {
      const result = validateTypeParam(undefined, 'test-tool');

      expect(result.message).toContain('core');
      expect(result.message).toContain('episodic');
      expect(result.message).toContain('semantic');
      expect(result.message).toContain('procedural');
      expect(result.message).toContain('vault');
      expect(result.message).toContain('working');
    });

    it('should include tool name in error message', () => {
      const result = validateTypeParam(undefined, 'remember');

      expect(result.message).toContain('remember');
    });
  });
});
