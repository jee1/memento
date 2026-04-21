import { describe, it, expect } from 'vitest';
import { isValidMemoryType, memoriesToCSV } from './utils.js';
import type { MemoryItem, MemoryType } from './types.js';

const buildMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'memory-1',
  content: 'Default content',
  type: 'episodic',
  importance: 3,
  created_at: '2026-04-20T00:00:00.000Z',
  pinned: false,
  tags: [],
  privacy_scope: 'private',
  ...overrides
});

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

describe('memoriesToCSV', () => {
  it('should return empty string for empty input', () => {
    expect(memoriesToCSV([])).toBe('');
  });

  it('should quote free-form fields and escape embedded double quotes', () => {
    const csv = memoriesToCSV([
      buildMemory({
        content: 'He said "hello"',
        tags: ['tag "one"', 'tag two'],
        source: 'api "import"'
      })
    ]);

    expect(csv).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"He said ""hello""",episodic,3,2026-04-20T00:00:00.000Z,,false,"tag ""one"";tag two",private,"api ""import"""'
    );
  });

  it('should neutralize formula-like content prefixes inside quoted cells', () => {
    expect(memoriesToCSV([buildMemory({ content: '=SUM(A1:A2)' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"\'=SUM(A1:A2)",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,'
    );
    expect(memoriesToCSV([buildMemory({ content: '+SUM(A1:A2)' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"\'+SUM(A1:A2)",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,'
    );
    expect(memoriesToCSV([buildMemory({ content: '-SUM(A1:A2)' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"\'-SUM(A1:A2)",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,'
    );
    expect(memoriesToCSV([buildMemory({ content: '@SUM(A1:A2)' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"\'@SUM(A1:A2)",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,'
    );
  });

  it('should neutralize formula-like tag prefixes after joining the tag string', () => {
    expect(memoriesToCSV([buildMemory({ tags: ['=danger', 'safe'] })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,"\'=danger;safe",private,'
    );
    expect(memoriesToCSV([buildMemory({ tags: ['+danger', 'safe'] })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,"\'+danger;safe",private,'
    );
    expect(memoriesToCSV([buildMemory({ tags: ['-danger', 'safe'] })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,"\'-danger;safe",private,'
    );
    expect(memoriesToCSV([buildMemory({ tags: ['@danger', 'safe'] })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,"\'@danger;safe",private,'
    );
  });

  it('should neutralize formula-like source prefixes after quoting the free-form fields', () => {
    expect(memoriesToCSV([buildMemory({ source: '=import' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,"\'=import"'
    );
    expect(memoriesToCSV([buildMemory({ source: '+import' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,"\'+import"'
    );
    expect(memoriesToCSV([buildMemory({ source: '-import' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,"\'-import"'
    );
    expect(memoriesToCSV([buildMemory({ source: '@import' })])).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,,private,"\'@import"'
    );
  });

  it('should only neutralize tags after joining the tag string', () => {
    const csv = memoriesToCSV([
      buildMemory({
        tags: ['safe', '=later']
      })
    ]);

    expect(csv).toBe(
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source\n' +
      'memory-1,"Default content",episodic,3,2026-04-20T00:00:00.000Z,,false,"safe;=later",private,'
    );
  });
});

