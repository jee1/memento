import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateTypeParam, parseTypeParamMode, type TypeParamMode } from './type-param-validator.js';

describe('type-param-validator', () => {
  describe('validateTypeParam', () => {
    describe('warn 모드', () => {
      it('should return valid result with default type when type is undefined', () => {
        const result = validateTypeParam(undefined, 'warn', 'test-tool');
        
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('warn');
        expect(result.defaultType).toBe('episodic');
        expect(result.message).toContain('type');
        expect(result.message).toContain('기본값');
        expect(result.message).toContain('episodic');
      });

      it('should return valid result with default type when type is empty string', () => {
        const result = validateTypeParam('', 'warn', 'test-tool');
        
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('warn');
        expect(result.defaultType).toBe('episodic');
        expect(result.message).toBeDefined();
      });

      it('should return valid result when type is provided', () => {
        const result = validateTypeParam('episodic', 'warn', 'test-tool');
        
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('warn');
        expect(result.defaultType).toBe('episodic');
        expect(result.message).toBeUndefined();
      });

      it('should include tool name in warning message', () => {
        const result = validateTypeParam(undefined, 'warn', 'remember');
        
        expect(result.message).toContain('remember');
      });
    });

    describe('deprecate 모드', () => {
      it('should return valid result with default type when type is undefined', () => {
        const result = validateTypeParam(undefined, 'deprecate', 'test-tool');
        
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('deprecate');
        expect(result.defaultType).toBe('episodic');
        expect(result.message).toContain('마이그레이션');
        expect(result.message).toContain('type-param-rollout');
      });

      it('should return valid result when type is provided', () => {
        const result = validateTypeParam('semantic', 'deprecate', 'test-tool');
        
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('deprecate');
        expect(result.defaultType).toBe('semantic');
        expect(result.message).toBeUndefined();
      });
    });

    describe('error 모드', () => {
      it('should return invalid result when type is undefined', () => {
        const result = validateTypeParam(undefined, 'error', 'test-tool');
        
        expect(result.isValid).toBe(false);
        expect(result.mode).toBe('error');
        expect(result.message).toContain('필수');
        expect(result.message).toContain('type');
      });

      it('should return invalid result when type is empty string', () => {
        const result = validateTypeParam('', 'error', 'test-tool');
        
        expect(result.isValid).toBe(false);
        expect(result.mode).toBe('error');
        expect(result.message).toBeDefined();
      });

      it('should return valid result when type is provided', () => {
        const result = validateTypeParam('procedural', 'error', 'test-tool');
        
        expect(result.isValid).toBe(true);
        expect(result.mode).toBe('error');
        expect(result.defaultType).toBe('procedural');
        expect(result.message).toBeUndefined();
      });

      it('should include valid type options in error message', () => {
        const result = validateTypeParam(undefined, 'error', 'test-tool');
        
        expect(result.message).toContain('core');
        expect(result.message).toContain('episodic');
        expect(result.message).toContain('semantic');
        expect(result.message).toContain('procedural');
        expect(result.message).toContain('vault');
        expect(result.message).toContain('working');
      });
    });

    describe('invalid mode', () => {
      it('should reject missing type for invalid mode', () => {
        const result = validateTypeParam(undefined, 'invalid' as TypeParamMode, 'test-tool');
        
        expect(result.isValid).toBe(false);
        expect(result.mode).toBe('error');
        expect(result.message).toContain('필수');
      });
    });
  });

  describe('parseTypeParamMode', () => {
    it('should return error for undefined', () => {
      expect(parseTypeParamMode(undefined)).toBe('error');
    });

    it('should return error for empty string', () => {
      expect(parseTypeParamMode('')).toBe('error');
    });

    it('should return warn for valid lowercase value', () => {
      expect(parseTypeParamMode('warn')).toBe('warn');
      expect(parseTypeParamMode('deprecate')).toBe('deprecate');
      expect(parseTypeParamMode('error')).toBe('error');
    });

    it('should return warn for valid uppercase value', () => {
      expect(parseTypeParamMode('WARN')).toBe('warn');
      expect(parseTypeParamMode('DEPRECATE')).toBe('deprecate');
      expect(parseTypeParamMode('ERROR')).toBe('error');
    });

    it('should return warn for valid mixed case value', () => {
      expect(parseTypeParamMode('Warn')).toBe('warn');
      expect(parseTypeParamMode('Deprecate')).toBe('deprecate');
      expect(parseTypeParamMode('Error')).toBe('error');
    });

    it('should return error for invalid value', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      expect(parseTypeParamMode('invalid')).toBe('error');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should trim whitespace', () => {
      expect(parseTypeParamMode('  warn  ')).toBe('warn');
      expect(parseTypeParamMode('  deprecate  ')).toBe('deprecate');
      expect(parseTypeParamMode('  error  ')).toBe('error');
    });
  });
});

