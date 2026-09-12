import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

import { resolveExampleDbPath, runExample } from './index.js';

describe('experimental example', () => {
  it('runs against an in-memory database', async () => {
    await expect(runExample(':memory:')).resolves.toBe(0);
  });

  it('passes :memory: through without rewriting (#962)', () => {
    expect(resolveExampleDbPath(':memory:')).toBe(':memory:');
  });

  it('expands a leading ~ in DB_PATH (#962)', () => {
    expect(resolveExampleDbPath('~/.memento/data/memory.db')).toBe(
      path.join(os.homedir(), '.memento', 'data', 'memory.db'),
    );
  });
});
