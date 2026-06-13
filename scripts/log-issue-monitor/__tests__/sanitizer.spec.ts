import { describe, expect, it } from 'vitest';
import { sanitizeExcerpt } from '../sanitizer.js';

describe('sanitizeExcerpt', () => {
  it('masks credentials and limits byte length', () => {
    const excerpt = sanitizeExcerpt('token=abcdefghijklmnopqrstuvwxyz123456 user@example.com trailing text', 40);

    expect(excerpt).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(excerpt).not.toContain('user@example.com');
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(40);
  });
  it('masks OpenAI sk-proj keys and env-style API keys', () => {
    const secret = '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';
    const excerpt = sanitizeExcerpt(`OPENAI_API_KEY=${secret}`, 4096);

    expect(excerpt).not.toContain('sk-proj');
    expect(excerpt).toContain('[API_KEY]');
  });

});
