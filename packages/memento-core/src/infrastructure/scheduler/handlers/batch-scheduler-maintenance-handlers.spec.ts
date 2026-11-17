import { describe, expect, it } from 'vitest';
import { formatProcessMemory } from './batch-scheduler-maintenance-handlers.js';

describe('formatProcessMemory', () => {
  it('reports absolute MiB for each field and heap fill apart from them', () => {
    const MIB = 1024 * 1024;
    const out = formatProcessMemory({
      rss: 640 * MIB,
      heapTotal: 100 * MIB,
      heapUsed: 50 * MIB,
      external: 30.55 * MIB,
      arrayBuffers: 10 * MIB
    });

    expect(out).toEqual({
      rssMiB: 640,
      heapUsedMiB: 50,
      heapTotalMiB: 100,
      externalMiB: 30.6,
      arrayBuffersMiB: 10,
      heapFillPercent: '50.0%'
    });
  });
});
