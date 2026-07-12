import { describe, it, expect } from 'vitest';
import { validateSource } from '../source-uri.js';

describe('validateSource', () => {
  it('빈 값은 유효로 처리한다', () => {
    expect(validateSource(undefined).isValid).toBe(true);
    expect(validateSource('').isValid).toBe(true);
    expect(validateSource('   ').isValid).toBe(true);
  });

  it('file:// URI를 허용한다', () => {
    const result = validateSource('file:///home/user/docs/note.md');
    expect(result.isValid).toBe(true);
    expect(result.type).toBe('file');
  });

  it('https:// URI를 허용한다', () => {
    const result = validateSource('https://github.com/jee1/memento/pull/671');
    expect(result.isValid).toBe(true);
    expect(result.type).toBe('https');
  });

  it('commit:<sha>를 허용한다', () => {
    const result = validateSource('commit:abc1234def5678');
    expect(result.isValid).toBe(true);
    expect(result.type).toBe('commit');
  });

  it('doc:<id>를 허용한다', () => {
    const result = validateSource('doc:security-guide-v2');
    expect(result.isValid).toBe(true);
    expect(result.type).toBe('doc');
  });

  it('memento://memory/{id}를 허용한다', () => {
    const result = validateSource('memento://memory/mem_123_abc');
    expect(result.isValid).toBe(true);
    expect(result.type).toBe('memento');
  });

  it('owner-scoped canonical memento URI를 허용한다', () => {
    const result = validateSource('memento://agent-a/memory/mem_123_abc');
    expect(result.isValid).toBe(true);
    expect(result.type).toBe('memento');
  });

  it('임의 문자열은 거절한다', () => {
    const result = validateSource('just-a-note');
    expect(result.isValid).toBe(false);
    expect(result.message).toBeDefined();
  });
});
