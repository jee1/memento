import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redactAgentEvent } from '../packages/memento-agent-integration/src/redaction.js';
import { eventFixture } from '../packages/memento-agent-integration/src/test-fixtures.js';
import { PIIMasker } from '../packages/memento-core/src/shared/utils/pii-masker.js';

// Agent event redaction and log PII masking keep separate rule tables in separate packages.
// Each sample is caught by exactly one rule in each table, so dropping any secret rule fails here.
// Values are assembled at runtime so secret scanners do not flag this file.
const value = 'plainvalue1234567890';
const SECRET_SAMPLES: ReadonlyArray<{ name: string; text: string; secret: string }> = [
  ['aws access key', ['AKIA', 'Q7'.repeat(8)].join('')],
  ['github token', ['ghp', 'Ab1'.repeat(12)].join('_')],
  ['slack token', ['xoxb', '1234567890', 'abcdefghij'].join('-')],
  ['google api key', ['AIzaSyD', 'Ab1'.repeat(10) + 'C'].join('-')],
  ['hex secret', 'fedcba9876543210'.repeat(2) + 'fedcba98'],
  ['openai key', ['sk', 'proj', 'Ab1'.repeat(8)].join('-')],
  ['stripe key', ['sk', 'live', '1234567890abcdef'].join('_')],
  ['jwt', ['eyJhbGciOiJI', 'eyJzdWIiOi', 'c2lnbmF0dXJl'].join('.')],
  ['high entropy secret', 'A9f3K2mP8qR4sT7vW1xY6zB0cD5eF9gH'],
].map(([name, secret]) => ({ name, text: `found ${secret} in output`, secret }))
  .concat([
    ['api key assignment', `api_key=${value}`],
    ['prefixed api key assignment', `OPENAI_API_KEY=${value}`],
    ['secret assignment', `DB_SECRET=${value}`],
    ['password assignment', `password=${value}`],
    ['pwd assignment', `pwd=${value}`],
    ['passwd assignment', `passwd=${value}`],
    ['token assignment', `token: ${value}`],
    ['bearer assignment', `bearer=${value}`],
    ['bearer header', `Authorization: Bearer ${value}`],
    ['key assignment', `key=${value}`],
    ['credential assignment', `credential=${value}`],
  ].map(([name, text]) => ({ name, text, secret: value })));

describe('secret redaction parity', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_PII_MASKING', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(SECRET_SAMPLES)('agent event redaction hides $name', ({ text, secret }) => {
    const result = redactAgentEvent(eventFixture('TOOL_RESULT', {
      payload: { tool_name: 'exec_command', outcome: 'error', output: { summary: text } },
    }));

    expect(result.action).toBe('REDACTED');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each(SECRET_SAMPLES)('log PII masking hides $name', ({ text, secret }) => {
    expect(PIIMasker.mask(text).masked).not.toContain(secret);
  });
});
