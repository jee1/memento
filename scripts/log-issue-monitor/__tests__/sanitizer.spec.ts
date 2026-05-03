import { describe, expect, it } from 'vitest';
import { sanitizeExcerpt } from '../sanitizer.js';

describe('sanitizeExcerpt', () => {
  it('masks credentials and limits byte length', () => {
    const excerpt = sanitizeExcerpt('token=abcdefghijklmnopqrstuvwxyz123456 user@example.com trailing text', 40);

    expect(excerpt).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(excerpt).not.toContain('user@example.com');
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(40);
  });
});
