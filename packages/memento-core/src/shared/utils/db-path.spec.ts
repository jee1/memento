import { describe, it, expect } from 'vitest';
import { validateAndNormalizeDbPath } from './db-path.js';

describe('validateAndNormalizeDbPath', () => {
  it('allows :memory: as-is', () => {
    expect(validateAndNormalizeDbPath(':memory:')).toBe(':memory:');
    expect(validateAndNormalizeDbPath('  :memory:  ')).toBe(':memory:');
  });

  it('allows file: URI as-is', () => {
    const uri = 'file:/abs/data.db';
    expect(validateAndNormalizeDbPath(uri)).toBe(uri);
    expect(validateAndNormalizeDbPath('file:./data.db')).toBe('file:./data.db');
  });

  it('normalizes file path to absolute', () => {
    const result = validateAndNormalizeDbPath('./data/memory.db');
    expect(result).not.toBe('./data/memory.db');
    expect(result).toMatch(/\/data\/memory\.db$/);
  });

  it('throws on empty or whitespace', () => {
    expect(() => validateAndNormalizeDbPath('')).toThrow('dbPath는 비어 있을 수 없습니다');
    expect(() => validateAndNormalizeDbPath('   ')).toThrow('dbPath는 비어 있을 수 없습니다');
    expect(() => validateAndNormalizeDbPath((undefined as unknown) as string)).toThrow();
  });
});
