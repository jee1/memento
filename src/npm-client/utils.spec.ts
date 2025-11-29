import { describe, it, expect } from 'vitest';
import { isValidMemoryType } from '../utils.js';
import type { MemoryType } from '../types.js';

describe('isValidMemoryType', () => {
  it('should return true for all valid memory types', () => {
    const validTypes: MemoryType[] = [
      'working',
      'episodic',
      'semantic',
      'procedural',
      'core',
      'vault'
    ];

    validTypes.forEach(type => {
      expect(isValidMemoryType(type)).toBe(true);
    });
  });

  it('should return false for invalid memory types', () => {
    const invalidTypes = [
      'invalid',
      'unknown',
      '',
      'WORKING', // case sensitive
      'episodic ', // with space
      'episodic\n', // with newline
      'episodic\t', // with tab
      'working,episodic', // multiple values
      '123',
      'null',
      'undefined'
    ];

    invalidTypes.forEach(type => {
      expect(isValidMemoryType(type)).toBe(false);
    });
  });

  it('should work as a type guard', () => {
    const testString: string = 'episodic';
    
    if (isValidMemoryType(testString)) {
      // TypeScript should narrow testString to MemoryType here
      const memoryType: MemoryType = testString; // Should not cause type error
      expect(memoryType).toBe('episodic');
    }
  });

  it('should handle core and vault types correctly', () => {
    expect(isValidMemoryType('core')).toBe(true);
    expect(isValidMemoryType('vault')).toBe(true);
    
    // Type guard should work for core and vault
    const coreType: string = 'core';
    if (isValidMemoryType(coreType)) {
      const memoryType: MemoryType = coreType;
      expect(memoryType).toBe('core');
    }

    const vaultType: string = 'vault';
    if (isValidMemoryType(vaultType)) {
      const memoryType: MemoryType = vaultType;
      expect(memoryType).toBe('vault');
    }
  });

  it('should be case sensitive', () => {
    expect(isValidMemoryType('WORKING')).toBe(false);
    expect(isValidMemoryType('Episodic')).toBe(false);
    expect(isValidMemoryType('SEMANTIC')).toBe(false);
    expect(isValidMemoryType('CORE')).toBe(false);
    expect(isValidMemoryType('VAULT')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isValidMemoryType('')).toBe(false);
    expect(isValidMemoryType(' ')).toBe(false);
    expect(isValidMemoryType('working ')).toBe(false);
    expect(isValidMemoryType(' working')).toBe(false);
  });
});

