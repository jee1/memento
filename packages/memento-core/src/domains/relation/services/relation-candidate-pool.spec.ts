import { describe, expect, it } from 'vitest';
import { clipRelationText } from './relation-candidate-pool.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('clipRelationText', () => {
  it('does not split an emoji that straddles the cut', () => {
    const text = `${'가'.repeat(199)}🏠 이후 내용`;
    const clipped = clipRelationText(text, 200);
    expect(LONE_SURROGATE.test(clipped)).toBe(false);
    expect(clipped).toBe(`${'가'.repeat(199)}...`);
  });

  it('keeps an emoji that ends exactly at the cut', () => {
    const text = `${'가'.repeat(198)}🏠 이후 내용`;
    expect(clipRelationText(text, 200)).toBe(`${'가'.repeat(198)}🏠...`);
  });

  it('returns short text unchanged', () => {
    expect(clipRelationText('짧은 🏠', 200)).toBe('짧은 🏠');
  });
});
