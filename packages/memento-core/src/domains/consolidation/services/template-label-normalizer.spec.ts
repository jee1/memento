import { describe, it, expect } from 'vitest';
import { stripMemoryTemplateLabels } from './template-label-normalizer.js';

describe('stripMemoryTemplateLabels', () => {
  const labels = ['결정', '근거', '버린 대안', '안 통한 것', '다음 걸림돌'] as const;

  it('strips all five labels at line start with and without bullet and extra spaces', () => {
    for (const label of labels) {
      const plain = `${label}:   keep this`;
      expect(stripMemoryTemplateLabels(plain)).toBe('keep this');

      const bullet = `-  ${label}  :  keep bullet`;
      expect(stripMemoryTemplateLabels(bullet)).toBe('keep bullet');

      const indented = `  ${label}: keep indented`;
      expect(stripMemoryTemplateLabels(indented)).toBe('keep indented');
    }
  });

  it('leaves text unchanged when no label is present', () => {
    const text = 'plain episodic body without template labels';
    expect(stripMemoryTemplateLabels(text)).toBe(text);
  });

  it('does not strip a label word in the middle of a line', () => {
    const text = '이번 결정: x';
    expect(stripMemoryTemplateLabels(text)).toBe(text);
  });

  it('is idempotent', () => {
    const text = `결정: alpha
근거: beta
버린 대안: gamma
안 통한 것: delta
다음 걸림돌: epsilon`;
    const once = stripMemoryTemplateLabels(text);
    expect(stripMemoryTemplateLabels(once)).toBe(once);
  });
});
