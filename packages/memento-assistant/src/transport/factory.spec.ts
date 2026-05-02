import { describe, it, expect } from 'vitest';
import { createTransportFromEnv } from './factory.js';
import { StdioTransport } from './stdio-transport.js';
import { HttpTransport } from './http-transport.js';

describe('createTransportFromEnv', () => {
  it('defaults to stdio with npx command', () => {
    const t = createTransportFromEnv({}, {});
    expect(t).toBeInstanceOf(StdioTransport);
  });

  it('uses http when MEMENTO_TRANSPORT=http and url present', () => {
    const t = createTransportFromEnv({}, {
      MEMENTO_TRANSPORT: 'http',
      MEMENTO_URL: 'http://localhost:9001',
      MEMENTO_TOKEN: 'tok',
    });
    expect(t).toBeInstanceOf(HttpTransport);
  });

  it('throws when http selected without url', () => {
    expect(() => createTransportFromEnv({}, { MEMENTO_TRANSPORT: 'http' }))
      .toThrow(/MEMENTO_URL/);
  });

  it('explicit transport option wins over env', () => {
    const explicit = new StdioTransport({ command: 'x', args: [] });
    const t = createTransportFromEnv({ transport: explicit }, { MEMENTO_TRANSPORT: 'http', MEMENTO_URL: 'http://x' });
    expect(t).toBe(explicit);
  });
});
