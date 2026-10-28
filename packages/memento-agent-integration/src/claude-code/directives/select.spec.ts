import { describe, expect, it } from 'vitest';

import {
  DIRECTIVE_POLICY,
  makeInjId,
  parseRecallItems,
  renderContext,
  selectCases,
  toCursorHookStdout,
  toHookStdout,
} from './select.js';
import { caseId, type CaseCandidate, type CaseId } from './types.js';

const cand = (id: string, text: string, final_score = 0.8): CaseCandidate => ({ id: caseId(id), text, final_score });
const none = new Set<CaseId>();

describe('parseRecallItems', () => {
  it('keeps items with string id and content and collapses whitespace', () => {
    const parsed = parseRecallItems({
      items: [
        { memory_id: 'a', content: 'line one\n  line two', final_score: 0.8 },
        { memory_id: 7, content: 'bad id' },
        { memory_id: 'c' },
        null,
        { memory_id: 'd', content: '   ' },
      ],
    });
    expect(parsed).toEqual([cand('a', 'line one line two')]);
  });

  it.each([undefined, null, '0.8', NaN, Infinity, -Infinity])('ignores invalid final_score (%s)', (final_score) => {
    expect(parseRecallItems({ items: [{ memory_id: 'bad', content: 'do not inject', final_score }] })).toEqual([]);
  });

  it.each([null, {}, { items: 'x' }, []])('throws when items is not an array (%j)', (raw) => {
    expect(() => parseRecallItems(raw)).toThrow();
  });
});

describe('selectCases', () => {
  it('excludes scores below the floor, including zero, and accepts the exact boundary', () => {
    const plan = selectCases([
      cand('low', 'irrelevant', 0.4999),
      cand('zero', 'irrelevant', 0),
      cand('boundary', 'relevant', 0.5),
      cand('above', 'relevant', 0.5001),
    ], none);
    expect(plan.chosen.map((c) => c.id)).toEqual(['boundary', 'above']);
    expect(plan.skipped).toEqual([]);
  });

  it('does not let low scores consume the count or byte budget', () => {
    const low = Array.from({ length: 6 }, (_, i) => cand(`low${i}`, '😀'.repeat(300), 0.1));
    expect(selectCases([...low, cand('ok', 'relevant')], none).chosen.map((c) => c.id)).toEqual(['ok']);
  });

  it('skips over-length cases by code points instead of truncating', () => {
    const exact = '가'.repeat(DIRECTIVE_POLICY.caseMaxChars);
    const emoji = '😀'.repeat(DIRECTIVE_POLICY.caseMaxChars);
    const tooLong = 'x'.repeat(DIRECTIVE_POLICY.caseMaxChars + 1);
    const plan = selectCases([cand('ok', exact), cand('emoji', emoji), cand('long', tooLong)], none);
    expect(plan.chosen.map((c) => c.id)).toEqual(['ok', 'emoji']);
    expect(plan.skipped).toEqual(['long']);
  });

  it('drops cases already in context and keeps rank order', () => {
    const plan = selectCases(
      [cand('a', 'A'), cand('b', 'B'), cand('c', 'C')],
      new Set([caseId('b')]),
    );
    expect(plan.chosen.map((c) => c.id)).toEqual(['a', 'c']);
    expect(plan.skipped).toEqual([]);
  });

  it('passes over a case that busts the byte budget without reporting it as skipped', () => {
    const heavy = '😀'.repeat(DIRECTIVE_POLICY.caseMaxChars);
    const plan = selectCases(
      [cand('1', heavy), cand('2', heavy), cand('3', heavy), cand('4', heavy), cand('small', 'tiny')],
      none,
    );
    expect(plan.chosen.map((c) => c.id)).toEqual(['1', '2', '3', 'small']);
    expect(plan.skipped).toEqual([]);
  });

  it('caps the number of chosen cases', () => {
    const many = Array.from({ length: 9 }, (_, i) => cand(`c${i}`, `case ${i}`));
    expect(selectCases(many, none).chosen).toHaveLength(DIRECTIVE_POLICY.maxCases);
  });
});

describe('renderContext', () => {
  const id = makeInjId('s', 1, 'p');

  it('always starts with the inj marker and ends with the cases-in-context list', () => {
    expect(renderContext(id, null, [], [])).toBe(`[inj:${id}]\n[cases-in-context: ]`);
    expect(renderContext(id, 'pin', [cand('a', 'do X')], [caseId('a')])).toBe(
      `[inj:${id}]\npin\n- do X\n[cases-in-context: a]`,
    );
  });

  it('builds inj_id from session prefix, epoch ms and prompt sha1 prefix', () => {
    expect(makeInjId('abcdefghijkl', 1761364800000, 'hello')).toBe('abcdefgh-1761364800000-aaf4c6');
    expect(makeInjId('s', 2, 'p')).not.toBe(id);
  });

  it('wraps the context as UserPromptSubmit additionalContext', () => {
    expect(JSON.parse(toHookStdout('ctx'))).toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'ctx' },
    });
  });

  it('wraps the same context as Cursor beforeSubmitPrompt additional_context', () => {
    expect(JSON.parse(toCursorHookStdout('ctx'))).toEqual({
      additional_context: 'ctx',
      continue: true,
    });
  });
});
