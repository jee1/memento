import { describe, expect, it } from 'vitest';
import { PIIMasker } from '../pii-masker.js';

describe('PIIMasker API key patterns', () => {
  const skProj =
    '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';

  it('masks sk-proj OpenAI keys', () => {
    const result = PIIMasker.mask(`OPENAI_API_KEY=${skProj}`);
    expect(result.masked).not.toContain('sk-proj');
    expect(result.masked).toContain('[API_KEY]');
    expect(result.maskedTypes).toContain('api_key');
  });

  it('masks legacy sk- keys', () => {
    const legacy = 'sk-' + 'a'.repeat(48);
    const result = PIIMasker.mask(legacy);
    expect(result.masked).not.toContain(legacy);
    expect(result.masked).toContain('[API_KEY]');
  });

  it('masks OPENAI_API_KEY env assignments in docker inspect JSON', () => {
    const json = JSON.stringify({
      Config: { Env: [`OPENAI_API_KEY=${skProj}`, 'NODE_ENV=production'] },
    });
    const result = PIIMasker.mask(json);
    expect(result.masked).not.toContain('sk-proj');
    expect(result.masked).toContain('[API_KEY]');
    expect(result.masked).toContain('NODE_ENV=production');
  });
});
