/**
 * IntrospectionScanCache 단위 테스트 (Issue #21 Phase B)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntrospectionScanCache } from '../introspection-scan-cache.js';

describe('IntrospectionScanCache', () => {
  let cache: IntrospectionScanCache;

  beforeEach(() => {
    cache = new IntrospectionScanCache();
  });

  it('get() returns null when nothing was set', () => {
    expect(cache.get()).toBeNull();
  });

  it('set() and get() store and return the scan result with scanned_at', () => {
    const result = {
      lowConfidenceMemoryIds: ['mem_1'],
      highFailureMemoryIds: ['mem_2', 'mem_3'],
      summary: '저신뢰 메모리 1건, 고실패 메모리 2건.'
    };
    const scanned_at = '2026-03-15T00:00:00.000Z';
    cache.set(result, scanned_at);
    const cached = cache.get();
    expect(cached).not.toBeNull();
    expect(cached!.result).toEqual(result);
    expect(cached!.scanned_at).toBe(scanned_at);
  });

  it('clear() removes cached value', () => {
    cache.set(
      { lowConfidenceMemoryIds: [], highFailureMemoryIds: [], summary: '없음.' },
      '2026-03-15T00:00:00.000Z'
    );
    expect(cache.get()).not.toBeNull();
    cache.clear();
    expect(cache.get()).toBeNull();
  });
});
