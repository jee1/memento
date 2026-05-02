import { describe, it, expect } from 'vitest';
import { shouldAutoRecall } from './auto-recall-policy.js';

describe('shouldAutoRecall', () => {
  it("'always' returns true regardless of message", () => {
    expect(shouldAutoRecall('always', 'hi')).toBe(true);
    expect(shouldAutoRecall('always', '')).toBe(true);
  });

  it("'off' returns false", () => {
    expect(shouldAutoRecall('off', 'hi?')).toBe(false);
  });

  it("'heuristic' is true for question marks", () => {
    expect(shouldAutoRecall('heuristic', 'where did we go last time?')).toBe(true);
  });

  it("'heuristic' is true for long messages", () => {
    expect(shouldAutoRecall('heuristic', 'a'.repeat(60))).toBe(true);
  });

  it("'heuristic' is false for short greetings", () => {
    expect(shouldAutoRecall('heuristic', 'hi')).toBe(false);
    expect(shouldAutoRecall('heuristic', '안녕')).toBe(false);
  });

  it("'heuristic' is true for pronoun reference", () => {
    expect(shouldAutoRecall('heuristic', 'that one was good')).toBe(true);
    expect(shouldAutoRecall('heuristic', '그거 어땠지')).toBe(true);
  });

  it('default mode is always', () => {
    expect(shouldAutoRecall(undefined, 'x')).toBe(true);
  });
});
