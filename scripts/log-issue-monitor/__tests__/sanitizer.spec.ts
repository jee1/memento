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
  it('removes user arguments while preserving diagnostic metadata', () => {
    const excerpt = sanitizeExcerpt('... | ERROR | [recall] 실패: | {"tool":"recall","args":{"query":"비밀 프로젝트 계획"},"error":"x"}', 4096);

    expect(excerpt).not.toContain('비밀 프로젝트 계획');
    expect(excerpt).toContain('"args":"[omitted]"');
    expect(excerpt).toContain('"tool":"recall"');
    expect(excerpt).toContain('"error":"x"');
  });

  it('omits a truncated JSON payload', () => {
    const excerpt = sanitizeExcerpt('... | ERROR | {"tool":"recall","query":"abc', 4096);

    expect(excerpt).not.toContain('abc');
    expect(excerpt).toContain('[payload omitted]');
  });

  it.each(['source', 'query', 'content'])('removes quoted %s arguments from messages', (key) => {
    const excerpt = sanitizeExcerpt(`failed (${key}='paperclip-ceo-heartbeat')`, 4096);

    expect(excerpt).not.toContain('paperclip-ceo-heartbeat');
    expect(excerpt).toContain(`(${key}='[omitted]')`);
  });

  it.each([
    'query', 'content', 'source', 'tags', 'args', 'arguments', 'params',
    'input', 'text', 'prompt', 'messages', 'context_text', 'summary',
  ])('removes nested %s fields on each excerpt line', (key) => {
    const payload = JSON.stringify({ tool: 'recall', details: [{ [key]: 'private-value', error: 'x' }] });
    const excerpt = sanitizeExcerpt(`first | ${payload}\nsecond | ${payload}`, 4096);

    expect(excerpt).not.toContain('private-value');
    for (const line of excerpt.split('\n')) {
      expect(line).toContain(`"${key}":"[omitted]"`);
      expect(line).toContain('"error":"x"');
    }
  });

});
