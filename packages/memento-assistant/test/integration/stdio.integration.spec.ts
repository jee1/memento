import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioTransport } from '../../src/transport/stdio-transport.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('stdio integration', { timeout: 30_000 }, () => {
  let t: StdioTransport;
  const bin = resolve(__dirname, '../../../memento-server/dist/server/index.js');

  beforeAll(async () => {
    t = new StdioTransport({
      command: 'node',
      args: [bin],
      env: { DB_PATH: ':memory:', MEMENTO_TYPE_PARAM_MODE: 'warn' },
    });
    await t.connect();
  });

  afterAll(async () => {
    await t.close();
  });

  it('roundtrip: remember → recall', async () => {
    await t.remember({ content: 'integration test fact', type: 'episodic' });
    const r = await t.recall('integration test fact', undefined, 5);
    expect(r.items.some(i => i.content.includes('integration test'))).toBe(true);
  });
});
