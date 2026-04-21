import { describe, expect, it } from 'vitest';

import { runExample } from './index.js';

describe('experimental example', () => {
  it('runs against an in-memory database', async () => {
    await expect(runExample(':memory:')).resolves.toBe(0);
  });
});
