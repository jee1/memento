import { describe, it, expect } from 'vitest';
import { rememberDispatch } from './auto-remember-policy.js';

describe('rememberDispatch', () => {
  it("'turn' returns single working memory entry", () => {
    const out = rememberDispatch('turn', { user: 'u', assistant: 'a' });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('working');
    expect(out[0].content).toContain('u');
    expect(out[0].content).toContain('a');
  });

  it("'decision' without extracted falls back to turn-only", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('working');
  });

  it("'decision' with fact emits semantic + working", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' }, [
      { kind: 'fact', content: 'birthday: 5/10' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find(x => x.type === 'semantic')?.content).toBe('birthday: 5/10');
    expect(out.find(x => x.type === 'working')).toBeDefined();
  });

  it("'decision' with preference assigns importance 0.7", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' }, [
      { kind: 'preference', content: 'prefers tea over coffee' },
    ]);
    const sem = out.find(x => x.type === 'semantic')!;
    expect(sem.importance).toBeCloseTo(0.7);
  });

  it("'decision' with event maps to episodic", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' }, [
      { kind: 'event', content: 'met X', at: '2026-05-10T10:00:00Z' },
    ]);
    expect(out.find(x => x.type === 'episodic')).toBeDefined();
  });

  it("'off' returns empty", () => {
    const out = rememberDispatch('off', { user: 'u', assistant: 'a' });
    expect(out).toEqual([]);
  });
});
