import { describe, it, expect } from 'vitest';
import { MemoryType, MemoryTypeRequest, isMemoryItemType } from './index.js';

describe('MemoryTypeRequest and isMemoryItemType', () => {
  describe('isMemoryItemType', () => {
    it('should return true for memory_item types', () => {
      expect(isMemoryItemType('working')).toBe(true);
      expect(isMemoryItemType('episodic')).toBe(true);
      expect(isMemoryItemType('semantic')).toBe(true);
      expect(isMemoryItemType('procedural')).toBe(true);
    });

    it('should return false for core and vault types', () => {
      expect(isMemoryItemType('core')).toBe(false);
      expect(isMemoryItemType('vault')).toBe(false);
    });

    it('should narrow type correctly when used as type guard', () => {
      const testType: MemoryTypeRequest = 'episodic';
      
      if (isMemoryItemType(testType)) {
        // TypeScript should narrow testType to MemoryType here
        const memoryType: MemoryType = testType; // Should not cause type error
        expect(memoryType).toBe('episodic');
      }
    });

    it('should work with all valid MemoryTypeRequest values', () => {
      const validTypes: MemoryTypeRequest[] = [
        'working',
        'episodic',
        'semantic',
        'procedural',
        'core',
        'vault'
      ];

      validTypes.forEach(type => {
        if (isMemoryItemType(type)) {
          // Should only be true for first 4 types
          expect(['working', 'episodic', 'semantic', 'procedural']).toContain(type);
        } else {
          // Should be false for core and vault
          expect(['core', 'vault']).toContain(type);
        }
      });
    });
  });

  describe('Type compatibility', () => {
    it('should allow MemoryTypeRequest to be used where MemoryTypeRequest is expected', () => {
      const requestType: MemoryTypeRequest = 'core';
      expect(requestType).toBe('core');
    });

    it('should allow MemoryType to be used where MemoryTypeRequest is expected', () => {
      const memoryType: MemoryType = 'episodic';
      const requestType: MemoryTypeRequest = memoryType; // Should be compatible
      expect(requestType).toBe('episodic');
    });

    it('should not allow MemoryTypeRequest to be used where MemoryType is expected without type guard', () => {
      const requestType: MemoryTypeRequest = 'core';
      // This should cause a type error if we try to assign directly
      // But we can test that isMemoryItemType properly filters it
      expect(isMemoryItemType(requestType)).toBe(false);
    });
  });
});

