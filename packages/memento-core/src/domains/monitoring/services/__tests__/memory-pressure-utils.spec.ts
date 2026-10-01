import { describe, it, expect } from 'vitest';
import { parseRssAnonBytes, getMemoryPressureNumeratorBytes } from '../memory-pressure-utils.js';

describe('memory-pressure-utils (#1199)', () => {
  it('parseRssAnonBytes 는 RssAnon kB 를 바이트로 바꾼다', () => {
    const status = 'Name:\tnode\nVmRSS:\t  913208 kB\nRssAnon:\t  565192 kB\nRssFile:\t  348016 kB\n';
    expect(parseRssAnonBytes(status)).toBe(565192 * 1024);
  });

  it('RssAnon 줄이 없으면 null', () => {
    expect(parseRssAnonBytes('VmRSS:\t 1 kB\n')).toBeNull();
  });

  it('getMemoryPressureNumeratorBytes 는 RSS 이하의 양수를 돌려준다', () => {
    const rss = process.memoryUsage().rss;
    const v = getMemoryPressureNumeratorBytes(rss);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(rss * 1.1);
  });
});
